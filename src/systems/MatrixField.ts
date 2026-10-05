import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import matrixFrag from '../shaders/matrix.frag?raw';
import glyphVert from '../shaders/glyphs.vert?raw';
import glyphFrag from '../shaders/glyphs.frag?raw';
import { ADDITIVE, type SharedUniforms } from '../renderer/uniforms';
import type { FieldParams } from '../config/presets';
import type { BreathingEngine } from './BreathingEngine';
import { SlowEnvelope, deriveSeed, mulberry32 } from '../util/random';

const ATLAS_COLS = 4;
const ATLAS_ROWS = 12;
const CELL_W = 256;
const CELL_H = 40;
const GLYPH_INSTANCES = 28;

/** Perceptual opacity -> additive linear light. Calibrated by eye. */
const OPACITY_GAIN = 0.85;

/**
 * The hidden computational geometry: analytic line field (fullscreen pass)
 * plus tiny engraved numeric markers / glyphs (instanced quads).
 */
export class MatrixField {
  readonly mesh: THREE.Mesh;
  readonly glyphs: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly glyphMaterial: THREE.ShaderMaterial;
  private readonly atlas: THREE.CanvasTexture;

  private sweep = 0;
  private sphereYaw = 0;
  private env!: Record<'reveal' | 'rings' | 'spokes' | 'sphere' | 'ticks' | 'marks' | 'glyphs', SlowEnvelope>;

  constructor(shared: SharedUniforms, seed: number) {
    this.atlas = buildAtlas(seed);
    this.reseed(seed);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: matrixFrag,
      uniforms: {
        ...shared,
        uOpacity: { value: 0 },
        uWeights: { value: new THREE.Vector4(1, 1, 1, 1) },
        uMarks: { value: 1 },
        uSphere: { value: new THREE.Vector3(0, 0.4, 0.1) },
        uSweep: { value: 0 },
        uSeed: { value: (seed % 997) * 0.37 },
      },
      ...ADDITIVE,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0.5, 0, 0); // x 0..1, y -0.5..0.5
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const data = new Float32Array(GLYPH_INSTANCES * 4);
    const rand = mulberry32(deriveSeed(seed, 'glyph-instances'));
    for (let i = 0; i < GLYPH_INSTANCES; i++) {
      data[i * 4] = rand();
      data[i * 4 + 1] = rand();
      data[i * 4 + 2] = rand();
      data[i * 4 + 3] = rand();
    }
    geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = GLYPH_INSTANCES;

    this.glyphMaterial = new THREE.ShaderMaterial({
      vertexShader: glyphVert,
      fragmentShader: glyphFrag,
      uniforms: {
        ...shared,
        uAtlas: { value: this.atlas },
        uOpacity: { value: 0 },
        uDensity: { value: 1 },
        uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
        uCells: { value: ATLAS_COLS * ATLAS_ROWS },
        uCellAspect: { value: CELL_W / CELL_H },
        uSize: { value: 0.022 },
      },
      ...ADDITIVE,
    });
    this.glyphs = new THREE.Mesh(geo, this.glyphMaterial);
    this.glyphs.frustumCulled = false;
    this.glyphs.renderOrder = 6;
  }

  reseed(seed: number) {
    const e = (label: string, period: number) => new SlowEnvelope(deriveSeed(seed, label), period);
    this.env = {
      reveal: e('m-reveal', 47),
      rings: e('m-rings', 29),
      spokes: e('m-spokes', 37),
      sphere: e('m-sphere', 53),
      ticks: e('m-ticks', 31),
      marks: e('m-marks', 23),
      glyphs: e('m-glyphs', 41),
    };
    if (this.material) this.material.uniforms.uSeed.value = (seed % 997) * 0.37;
    if (this.atlas) {
      drawAtlas(this.atlas.image as HTMLCanvasElement, seed);
      this.atlas.needsUpdate = true;
    }
  }

  /** `veil` (0..1) fades everything for seed changes / toggles. */
  update(dt: number, time: number, p: FieldParams, breath: BreathingEngine, veil: number) {
    this.sweep += dt * 0.0045;
    this.sphereYaw += dt * 0.0055;
    const E = this.env;

    // Occasionally becomes clearer, then recedes. Peaks are rare (power curve).
    const reveal = Math.pow(E.reveal.value(time), 2.6);
    const opacity =
      Math.min(0.16, p.matrixOpacity * (1 + p.matrixReveal * 1.8 * reveal)) * breath.mod(0.08) * veil;

    const u = this.material.uniforms;
    u.uOpacity.value = opacity * OPACITY_GAIN;
    u.uWeights.value.set(
      0.45 + 0.55 * E.rings.value(time),
      0.2 + 0.8 * E.spokes.value(time),
      p.sphereGrid * (0.2 + 0.8 * E.sphere.value(time)),
      0.35 + 0.65 * E.ticks.value(time),
    );
    u.uMarks.value = 0.2 + 0.8 * E.marks.value(time);
    u.uSphere.value.set(
      this.sphereYaw,
      0.42 + 0.14 * Math.sin(time * 0.0031),
      0.18 * Math.sin(time * 0.0019 + 1.1),
    );
    u.uSweep.value = this.sweep;

    const g = this.glyphMaterial.uniforms;
    g.uOpacity.value = opacity * 1.6 * p.glyphs * (0.3 + 0.7 * E.glyphs.value(time));
    g.uDensity.value = Math.min(1, 0.35 + p.glyphs * 0.65);

    const visible = opacity > 0.0004;
    this.mesh.visible = visible;
    this.glyphs.visible = visible && p.glyphs > 0.01;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.glyphs.geometry.dispose();
    this.glyphMaterial.dispose();
    this.atlas.dispose();
  }
}

// ---------------------------------------------------------------------------
// Glyph atlas - generated locally with Canvas 2D and system fonts (no font
// downloads). Content is seeded: abstract coordinates, ratios, symbols.

const SYMBOLS = ['☉', '☽', '♁', '☿', '♄', '♃', '✶', '∴', '∞', '⊙', '△', '◇', 'Ω', 'Ψ', 'φ', 'λ', 'Σ', '⟡', '≋', '⊕'];
const GREEK = ['α', 'β', 'γ', 'δ', 'θ', 'λ', 'μ', 'ρ', 'σ', 'τ', 'φ', 'ω'];

function makeLabels(seed: number, count: number): string[] {
  const rand = mulberry32(deriveSeed(seed, 'glyph-labels'));
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const num = (int: number, frac: number) => {
    const v = rand() * Math.pow(10, int);
    return v.toFixed(frac).padStart(int + (frac ? frac + 1 : 0), '0');
  };
  const makers: (() => string)[] = [
    () => num(3, 1),
    () => `${num(3, 0)}°`,
    () => `${pick(GREEK)} ${num(1, 3)}`,
    () => `${pick(GREEK)}${num(2, 0)}  ${num(2, 2)}`,
    () => `r ${(0.5 + rand() * 2).toFixed(3)}`,
    () => `${Math.floor(rand() * 24).toString().padStart(2, '0')}h ${num(2, 0)}m`,
    () => `${rand() < 0.5 ? '+' : '−'}${num(2, 0)}° ${num(2, 0)}′`,
    () => pick(SYMBOLS),
    () => `${pick(SYMBOLS)} ${num(2, 1)}`,
    () => ['0.618', '1.618', '137.5°', '2.414', '√5', '3.14159', '0.0729', '1:1.32'][Math.floor(rand() * 8)],
    () => `N-${num(2, 0)}`,
    () => `${num(1, 4)}`,
  ];
  return Array.from({ length: count }, () => makers[Math.floor(rand() * makers.length)]());
}

function drawAtlas(canvas: HTMLCanvasElement, seed: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  const labels = makeLabels(seed, ATLAS_COLS * ATLAS_ROWS);
  labels.forEach((label, i) => {
    const x = (i % ATLAS_COLS) * CELL_W;
    const y = Math.floor(i / ATLAS_COLS) * CELL_H;
    const symbolic = /[^\x20-\x7e°′−]/.test(label);
    ctx.font = symbolic
      ? '300 26px "Segoe UI Symbol", "Segoe UI", "Noto Sans Symbols", "DejaVu Sans", serif'
      : '300 24px "Consolas", "Cascadia Mono", "DejaVu Sans Mono", monospace';
    ctx.globalAlpha = 0.95;
    ctx.fillText(label, x + 10, y + CELL_H / 2 + 1, CELL_W - 20);
  });
}

function buildAtlas(seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_W;
  canvas.height = ATLAS_ROWS * CELL_H;
  drawAtlas(canvas, seed);
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 2;
  return tex;
}
