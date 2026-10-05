import * as THREE from 'three';
import vert from '../shaders/particles.vert?raw';
import frag from '../shaders/particles.frag?raw';
import { buildShader } from '../util/glsl';
import { mulberry32 } from '../util/random';
import type { SharedUniforms } from '../renderer/uniforms';

export interface PopulationSpec {
  name: string;
  count: number;
  depth: [number, number];
  size: [number, number];
  life: [number, number];
  radiusMax: number;
  speed: number;
  inflow: number;
  tint: number;
  twinkle: number;
  softness: number;
  brightness: number;
  /** Fraction of particles that spin against the main vortex. */
  counterSpin: number;
}

export class Population {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;

  constructor(readonly spec: PopulationSpec, shared: SharedUniforms, seed: number) {
    const rand = mulberry32(seed);
    const n = spec.count;
    const seeds = new Float32Array(n * 4);
    const params = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seeds[i * 4 + 0] = rand();
      seeds[i * 4 + 1] = rand();
      seeds[i * 4 + 2] = rand();
      seeds[i * 4 + 3] = rand();
      params[i * 4 + 0] = rand();
      params[i * 4 + 1] = rand();
      params[i * 4 + 2] = rand() < spec.counterSpin ? -1 : 1;
      // Ranks are evenly spread so density changes thin the field uniformly.
      params[i * 4 + 3] = (i + rand()) / n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    geo.setAttribute('aParams', new THREE.BufferAttribute(params, 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: buildShader(vert),
      fragmentShader: buildShader(frag),
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
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
