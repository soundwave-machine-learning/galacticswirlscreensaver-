import * as THREE from 'three';
import vortexVert from '../shaders/vortex.vert?raw';
import vortexFrag from '../shaders/vortex.frag?raw';
import { buildShader } from '../util/glsl';
import { createSharedUniforms, type SharedUniforms } from './uniforms';
import { PostFX } from './PostFX';
import { ParticleField } from '../systems/ParticleField';
import { NodeNetwork } from '../systems/NodeNetwork';
import { MatrixField } from '../systems/MatrixField';
import { BreathingEngine } from '../systems/BreathingEngine';
import { TransitionEngine } from '../systems/TransitionEngine';
import type { LoadedField } from '../systems/TextureField';
import {
  QUALITY,
  TIMING,
  type FieldParams,
  type QualityLevel,
} from '../config/presets';
import { approach, deriveSeed, mulberry32 } from '../util/random';

const TAU = Math.PI * 2;

export interface SceneOptions {
  seed: number;
  quality: QualityLevel;
  params: FieldParams;
  startField?: number;
}

/** Sinusoid bank for imperceptible camera drift with seeded phases. */
class Drift {
  private terms: { amp: number; freq: number; phase: number }[];
  constructor(seed: number, periods: number[]) {
    const rand = mulberry32(seed);
    const total = periods.length;
    this.terms = periods.map((p) => ({
      amp: (0.6 + 0.8 * rand()) / total,
      freq: TAU / p,
      phase: rand() * TAU,
    }));
  }
  value(t: number) {
    let v = 0;
    for (const term of this.terms) v += term.amp * Math.sin(t * term.freq + term.phase);
    return v;
  }
}

/**
 * Owns the renderer and every visual system. `update(simDt, realDt)`
 * advances the simulation (simDt is 0 while paused) while parameter easing
 * and fades keep moving in real time so controls stay responsive.
 */
export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly shared: SharedUniforms;
  readonly breathing = new BreathingEngine(12);
  transitions!: TransitionEngine;

  /** Parameters currently on screen (eased toward `target`). */
  readonly params: FieldParams;
  target: FieldParams;

  /** User "Transition Speed": scales field sequencing only, not motion. */
  transitionSpeed = 1;
  matrixEnabled = true;
  particlesEnabled = true;

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly post: PostFX;
  private vortex!: THREE.ShaderMaterial;
  private particles!: ParticleField;
  private nodes!: NodeNetwork;
  private matrix!: MatrixField;
  private fields: LoadedField[] = [];

  private time = 0;
  private realTime = 0;
  private flowTime = 0;
  private rotation = 0;
  private seed: number;
  private quality: QualityLevel;
  private pendingSeed: number | null = null;

  // Fades (0..1) - nothing ever pops on or off.
  private seedVeil = 1;
  private matrixVeil = 1;
  private particleVeil = 1;
  private startFade = 0;

  private drift!: { x: Drift; y: Drift; zoom: Drift; roll: Drift };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: SceneOptions,
  ) {
    this.seed = opts.seed;
    this.quality = opts.quality;
    this.params = { ...opts.params };
    this.target = { ...opts.params };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;

    this.shared = createSharedUniforms();
    this.post = new PostFX(this.renderer);

    const quad = new THREE.PlaneGeometry(2, 2);
    this.vortex = this.createVortexMaterial(QUALITY[this.quality].fbmOctaves);
    const bg = new THREE.Mesh(quad, this.vortex);
    bg.frustumCulled = false;
    bg.renderOrder = 0;
    this.scene.add(bg);

    this.buildSeeded(this.seed, opts.startField ?? 0);
    this.resize();
  }

  get currentSeed() {
    return this.seed;
  }

  get currentQuality() {
    return this.quality;
  }

  get simulationTime() {
    return this.time;
  }

  get fieldName() {
    return this.fields[this.transitions.current]?.source.name ?? '';
  }

  get debug() {
    return {
      quality: this.quality,
      seed: this.seed,
      field: this.transitions.current,
      next: this.transitions.next,
      mix: this.transitions.mix,
      emergence: this.transitions.emergence,
      links: this.nodes.activeLinks,
      phase: this.transitions.state,
      timeToNext: this.transitions.timeToNext,
      size: this.post.size,
      particles: {
        stars: QUALITY[this.quality].stars,
        dust: QUALITY[this.quality].dust,
        nodes: QUALITY[this.quality].nodes,
        starDensity: this.params.stars,
        dustDensity: this.params.dust,
        nodeDensity: this.params.nodes,
      },
    };
  }

  private createVortexMaterial(octaves: number) {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vortexVert,
      fragmentShader: buildShader(vortexFrag, { FBM_OCTAVES: octaves }),
      uniforms: {
        ...this.shared,
        uFlowPhase: { value: 0 },
        uFlowPeriod: { value: TIMING.flowPeriod },
        uVortexStrength: { value: 0 },
        uNoiseAmount: { value: 0 },
        uChromaticDispersion: { value: 0 },
        uExposure: { value: 1 },
        uContrast: { value: 1 },
        uSaturation: { value: 1 },
        uHighlightLift: { value: 0 },
        uVoid: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Builds every seed-dependent system (particles, nodes, matrix, drift). */
  private buildSeeded(seed: number, startField: number) {
    const q = QUALITY[this.quality];
    const firstBuild = !this.particles;
    if (firstBuild) {
      this.particles = new ParticleField(this.shared, { stars: q.stars, dust: q.dust }, seed);
      this.scene.add(this.particles.group);
      this.matrix = new MatrixField(this.shared, seed);
      this.scene.add(this.matrix.mesh, this.matrix.glyphs);
      this.transitions = new TransitionEngine(3, deriveSeed(seed, 'transitions'), startField);
      const rand = mulberry32(deriveSeed(seed, 'noise-offset'));
      this.shared.uSeedOffset.value.set(rand() * 40 - 20, rand() * 40 - 20, rand() * 40);
    } else {
      this.particles.rebuild({ stars: q.stars, dust: q.dust }, seed);
      this.matrix.reseed(seed);
      this.scene.remove(this.nodes.points, this.nodes.lines);
      this.nodes.dispose();
    }
    this.nodes = new NodeNetwork(this.shared, q.nodes, seed);
    this.scene.add(this.nodes.points, this.nodes.lines);

    const d = (label: string, periods: number[]) => new Drift(deriveSeed(seed, label), periods);
    this.drift = {
      x: d('drift-x', [173, 311, 547]),
      y: d('drift-y', [197, 367, 613]),
      zoom: d('drift-zoom', [229, 401, 709]),
      roll: d('drift-roll', [263, 457, 811]),
    };
  }

  setFields(fields: LoadedField[]) {
    this.fields = fields;
    this.transitions = new TransitionEngine(fields.length, deriveSeed(this.seed, 'transitions'), this.transitions.current);
    this.bindFields();
  }

  private bindFields() {
    if (!this.fields.length) return;
    const a = this.fields[this.transitions.current];
    const b = this.fields[this.transitions.next];
    const s = this.shared;
    s.uTexA.value = a.texture;
    s.uTexCenterA.value.copy(a.center);
    s.uTexB.value = b.texture;
    s.uTexCenterB.value.copy(b.center);
  }

  /** Smoothly fades the seeded systems out, rebuilds them, and fades back in. */
  reseed(seed: number) {
    this.pendingSeed = seed;
  }

  nextField() {
    this.transitions.advance();
  }

  setQuality(level: QualityLevel) {
    if (level === this.quality) return;
    const prev = QUALITY[this.quality];
    this.quality = level;
    const q = QUALITY[level];
    if (q.fbmOctaves !== prev.fbmOctaves) {
      const old = this.vortex;
      this.vortex = this.createVortexMaterial(q.fbmOctaves);
      const bg = this.scene.children.find((c) => (c as THREE.Mesh).material === old) as THREE.Mesh;
      bg.material = this.vortex;
      old.dispose();
    }
    // Particle i is identical at every count, so only the extra ones change.
    this.particles.rebuild({ stars: q.stars, dust: q.dust }, this.seed);
    this.scene.remove(this.nodes.points, this.nodes.lines);
    this.nodes.dispose();
    this.nodes = new NodeNetwork(this.shared, q.nodes, this.seed);
    this.scene.add(this.nodes.points, this.nodes.lines);
    this.resize();
  }

  resize() {
    const q = QUALITY[this.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(cw, ch, false);
    const sw = Math.max(1, Math.round(cw * q.renderScale));
    const sh = Math.max(1, Math.round(ch * q.renderScale));
    this.post.configure(sw, sh, q.bloomLevels, q.msaa);

    const m = Math.min(sw, sh);
    this.shared.uAspect.value.set(sw / m, sh / m);
    this.shared.uPixelsPerUnit.value = m / 2;
    this.updateCover();
  }

  private updateCover() {
    const a = this.shared.uAspect.value;
    // Cover fit for square paintings with margin for rotation and drift.
    this.shared.uCover.value = (2 * Math.max(a.x, a.y) * 1.1) / Math.max(0.5, this.params.textureZoom);
  }

  setToggles(matrix: boolean, particles: boolean) {
    this.matrixEnabled = matrix;
    this.particlesEnabled = particles;
  }

  update(simDt: number, realDt: number) {
    this.realTime += realDt;
    this.time += simDt;
    this.flowTime += simDt;

    // Ease parameters toward their targets in real time.
    const p = this.params as unknown as Record<string, number>;
    const t = this.target as unknown as Record<string, number>;
    for (const key in t) p[key] = approach(p[key], t[key], realDt, TIMING.paramSettle);

    this.startFade = approach(this.startFade, 1, realDt, 0.9);
    this.matrixVeil = approach(this.matrixVeil, this.matrixEnabled ? 1 : 0, realDt, 0.8);
    this.particleVeil = approach(this.particleVeil, this.particlesEnabled ? 1 : 0, realDt, 0.8);
    if (this.pendingSeed !== null) {
      this.seedVeil = approach(this.seedVeil, 0, realDt, 0.35);
      if (this.seedVeil < 0.01) {
        this.seed = this.pendingSeed;
        this.pendingSeed = null;
        this.buildSeeded(this.seed, this.transitions.current);
        this.bindFields();
      }
    } else {
      this.seedVeil = approach(this.seedVeil, 1, realDt, 1.2);
    }

    const prevCurrent = this.transitions.current;
    this.transitions.update(simDt * this.transitionSpeed);
    if (this.transitions.current !== prevCurrent || this.shared.uTexA.value === null) this.bindFields();

    this.breathing.setBasePeriod(this.params.breathingPeriod);
    this.breathing.amount = this.params.breathingAmount;
    this.breathing.update(simDt);
    const b = this.breathing;
    const P = this.params;

    // Uniform field rotation: one consistent direction, speed slowly varying.
    this.rotation += simDt * P.rotationSpeed * (0.65 + 0.35 * Math.sin(this.time * 0.0041 + 0.7));
    this.rotation %= TAU;

    const s = this.shared;
    s.uTime.value = this.time;
    s.uRotation.value = this.rotation;
    s.uMix.value = this.transitions.mix;
    s.uEmergence.value = this.transitions.emergence;
    s.uBreath.value = b.value;
    s.uCenter.value.set(P.centerX, P.centerY);
    s.uVortexRadius.value = P.vortexRadius;
    // Bounded differential twist: slow, irregular, never accumulating.
    const tw = Math.sin((this.time * TAU) / 173) * 0.7 + Math.sin((this.time * TAU) / 389 + 1.3) * 0.3;
    s.uTwist.value = P.twistAmount * tw * b.mod(0.06);

    const D = this.drift;
    s.uCamera.value.set(
      P.panDrift * D.x.value(this.time),
      P.panDrift * D.y.value(this.time),
      (1 + P.zoomDrift * (0.5 + 0.5 * D.zoom.value(this.time))) * b.mod(0.012),
      P.rollDrift * D.roll.value(this.time),
    );
    this.updateCover();

    const v = this.vortex.uniforms;
    v.uFlowPhase.value = (this.flowTime / TIMING.flowPeriod) % 1;
    v.uVortexStrength.value = P.vortexStrength * b.mod(0.05);
    v.uNoiseAmount.value = P.noiseAmount;
    v.uChromaticDispersion.value = P.chromaticDispersion;
    v.uExposure.value = P.exposure;
    v.uContrast.value = P.contrast;
    v.uSaturation.value = P.saturation;
    v.uHighlightLift.value = P.highlightLift;
    v.uVoid.value = P.voidAmount;

    const veil = this.seedVeil * this.startFade;
    this.matrix.update(simDt, this.time, P, b, veil * this.matrixVeil);
    this.particles.update(P, b, veil * this.particleVeil);
    const pixelScale = Math.min(this.post.size.width, this.post.size.height) / 1080;
    this.nodes.update(simDt, this.time, {
      density: P.nodes,
      brightness: P.particleBrightness * b.mod(0.08) * 1.1,
      maxLinks: P.connections,
      pixelScale,
      veil: veil * this.particleVeil,
    });
    this.nodes.setOpacity(0.2 * Math.min(1.3, P.particleBrightness) * this.matrixVeil);
  }

  render() {
    this.renderer.setRenderTarget(this.post.sceneTarget);
    this.renderer.render(this.scene, this.camera);
    const P = this.params;
    this.post.render(
      {
        exposure: 1,
        bloomStrength: P.bloomStrength * this.breathing.mod(0.06),
        bloomThreshold: P.bloomThreshold,
        vignette: P.vignette,
        grain: P.grain,
        chromaticAberration: P.chromaticAberration,
        fade: Math.min(1, this.startFade * 1.05),
      },
      this.realTime,
    );
  }

  dispose() {
    this.particles.dispose();
    this.nodes.dispose();
    this.matrix.dispose();
    this.vortex.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
