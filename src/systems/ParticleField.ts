import * as THREE from 'three';
import vert from '../shaders/particles.vert?raw';
import frag from '../shaders/particles.frag?raw';
import { mulberry32, deriveSeed } from '../util/random';
import { ADDITIVE, type SharedUniforms } from '../renderer/uniforms';
import { POPULATIONS, type FieldParams, type PopulationSpec } from '../config/presets';
import type { BreathingEngine } from './BreathingEngine';

/** One GPU-animated particle population (a single draw call). */
export class Population {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor(
    readonly spec: PopulationSpec,
    shared: SharedUniforms,
    count: number,
    seed: number,
  ) {
    // Attributes are drawn sequentially from a seeded stream, so particle i
    // is identical whatever the total count - quality changes keep the field.
    const rand = mulberry32(seed);
    const seeds = new Float32Array(count * 4);
    const params = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4 + 0] = rand();
      seeds[i * 4 + 1] = rand();
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
      params[i * 4 + 0] = rand();
      params[i * 4 + 1] = rand();
      params[i * 4 + 2] = rand() < spec.counterSpin ? -1 : 1;
      params[i * 4 + 3] = rand(); // rank for soft density culling
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        ...shared,
        uDepthRange: { value: new THREE.Vector2(...spec.depth) },
        uSizeRange: { value: new THREE.Vector2(...spec.size) },
        uLifeRange: { value: new THREE.Vector2(...spec.life) },
        uRadiusMax: { value: spec.radiusMax },
        uSpeed: { value: spec.speed },
        uInflow: { value: spec.inflow },
        uTintAmount: { value: spec.tint },
        uTwinkle: { value: spec.twinkle },
        uBrightness: { value: spec.brightness },
        uDensity: { value: 1 },
        uSoftness: { value: spec.softness },
        uEmergeBoost: { value: spec.emergeBoost },
      },
      ...ADDITIVE,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  set(density: number, brightness: number) {
    const u = this.material.uniforms;
    u.uDensity.value = density;
    u.uBrightness.value = this.spec.brightness * brightness;
    this.points.visible = density > 0.001 && brightness > 0.001;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Layers 1 and 2: distant stars and slow dust. (Layer 3, nodes, is NodeNetwork.) */
export class ParticleField {
  readonly group = new THREE.Group();
  private stars: Population;
  private dust: Population;

  constructor(
    private readonly shared: SharedUniforms,
    counts: { stars: number; dust: number },
    seed: number,
  ) {
    this.stars = new Population(POPULATIONS.stars, shared, counts.stars, deriveSeed(seed, 'stars'));
    this.dust = new Population(POPULATIONS.dust, shared, counts.dust, deriveSeed(seed, 'dust'));
    this.stars.points.renderOrder = 2;
    this.dust.points.renderOrder = 3;
    this.group.add(this.stars.points, this.dust.points);
  }

  rebuild(counts: { stars: number; dust: number }, seed: number) {
    this.dispose();
    this.group.clear();
    this.stars = new Population(POPULATIONS.stars, this.shared, counts.stars, deriveSeed(seed, 'stars'));
    this.dust = new Population(POPULATIONS.dust, this.shared, counts.dust, deriveSeed(seed, 'dust'));
    this.stars.points.renderOrder = 2;
    this.dust.points.renderOrder = 3;
    this.group.add(this.stars.points, this.dust.points);
  }

  update(p: FieldParams, breath: BreathingEngine, veil: number) {
    const b = p.particleBrightness * breath.mod(0.07) * veil;
    this.stars.set(p.stars, b);
    this.dust.set(p.dust, b);
  }

  dispose() {
    this.stars.dispose();
    this.dust.dispose();
  }
}
