import * as THREE from 'three';
import vortexVert from '../shaders/vortex.vert?raw';
import vortexFrag from '../shaders/vortex.frag?raw';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import compositeFrag from '../shaders/composite.frag?raw';
import { buildShader } from '../util/glsl';
import { createSharedUniforms, type SharedUniforms } from './uniforms';
import { Population, type PopulationSpec } from '../systems/ParticleField';
import { BreathingEngine } from '../systems/BreathingEngine';
import type { LoadedField } from '../systems/TextureField';

const TAU = Math.PI * 2;

const DUST: PopulationSpec = {
  name: 'dust',
  count: 1200,
  depth: [0.7, 3.5],
  size: [0.004, 0.02],
  life: [60, 220],
  radiusMax: 1.9,
  speed: 0.012,
  inflow: 0.0012,
  tint: 0.75,
  twinkle: 0.25,
  softness: 0.6,
  brightness: 0.55,
  counterSpin: 0.25,
};

/** Proof-of-concept scene: one painting, spiral field, breathing, particles. */
export class Scene {
  readonly renderer: THREE.WebGLRenderer;
  readonly shared: SharedUniforms;
  readonly breathing = new BreathingEngine(11);

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly scene = new THREE.Scene();
  private readonly post = new THREE.Scene();
  private readonly vortex: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly dust: Population;
  private target: THREE.WebGLRenderTarget;

  private time = 0;
  private flowTime = 0;
  private rotation = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);

    this.shared = createSharedUniforms();

    const quad = new THREE.PlaneGeometry(2, 2);
    this.vortex = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vortexVert,
      fragmentShader: buildShader(vortexFrag, { FBM_OCTAVES: 4 }),
      uniforms: {
        ...this.shared,
        uFlowPhase: { value: 0 },
        uFlowPeriod: { value: 28 },
        uVortexStrength: { value: 0.012 },
        uVortexRadius: { value: 0.55 },
        uTwist: { value: 0 },
        uNoiseAmount: { value: 0.018 },
        uChromaticDispersion: { value: 0.04 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const bg = new THREE.Mesh(quad, this.vortex);
    bg.frustumCulled = false;
    bg.renderOrder = -1;
    this.scene.add(bg);

    this.dust = new Population(DUST, this.shared, 1234);
    this.scene.add(this.dust.points);

    this.target = this.createTarget(1, 1);
    this.composite = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: compositeFrag,
      uniforms: {
        uScene: { value: this.target.texture },
        uExposure: { value: 1.0 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const out = new THREE.Mesh(quad, this.composite);
    out.frustumCulled = false;
    this.post.add(out);

    this.resize();
  }

  setField(field: LoadedField) {
    this.shared.uTex.value = field.texture;
    this.shared.uTexCenter.value.copy(field.center);
  }

  private createTarget(w: number, h: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.target.setSize(w, h);
    const m = Math.min(w, h);
    this.shared.uAspect.value.set(w / m, h / m);
    this.shared.uPixelsPerUnit.value = m / 2;
    this.shared.uCover.value = 2 * Math.max(w / m, h / m) * 1.08;
  }

  update(dt: number) {
    this.time += dt;
    this.flowTime += dt;
    this.breathing.update(dt);
    const b = this.breathing;

    // ~1 revolution per 40 minutes, direction slowly reversing every few minutes.
    this.rotation += dt * 0.0026 * Math.sin(this.time * 0.0021 + 0.9);

    const period = this.vortex.uniforms.uFlowPeriod.value as number;
    this.vortex.uniforms.uFlowPhase.value = (this.flowTime / period) % 1;
    this.vortex.uniforms.uTwist.value = 0.35 * Math.sin((this.time * TAU) / 173) * b.mod(0.05);
    this.vortex.uniforms.uVortexStrength.value = 0.012 * b.mod(0.05);

    const s = this.shared;
    s.uTime.value = this.time;
    s.uRotation.value = this.rotation % TAU;
    s.uCamera.value.set(
      0.012 * Math.sin(this.time * 0.0071) + 0.006 * Math.sin(this.time * 0.019 + 2.0),
      0.009 * Math.sin(this.time * 0.0093 + 1.3),
      (1.0 + 0.008 * Math.sin(this.time * 0.0047)) * b.mod(0.012),
      0.006 * Math.sin(this.time * 0.0033 + 0.4),
    );
    this.dust.material.uniforms.uBrightness.value = DUST.brightness * b.mod(0.06);
    this.composite.uniforms.uTime.value = this.time;
  }

  render() {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.post, this.camera);
  }
}
