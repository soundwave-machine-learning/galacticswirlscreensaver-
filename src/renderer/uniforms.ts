import * as THREE from 'three';

/**
 * Uniform objects shared by reference between every material, so one
 * write per frame updates the whole scene.
 */
export function createSharedUniforms() {
  return {
    uTime: { value: 0 },
    uAspect: { value: new THREE.Vector2(1, 1) },
    uCamera: { value: new THREE.Vector4(0, 0, 1, 0) },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uRotation: { value: 0 },
    uTwist: { value: 0 },
    uVortexRadius: { value: 0.5 },
    uPixelsPerUnit: { value: 500 },
    uTexA: { value: null as THREE.Texture | null },
    uTexB: { value: null as THREE.Texture | null },
    uTexCenterA: { value: new THREE.Vector2(0.5, 0.5) },
    uTexCenterB: { value: new THREE.Vector2(0.5, 0.5) },
    uMix: { value: 0 },
    uEmergence: { value: 0 },
    uCover: { value: 4 },
    uSeedOffset: { value: new THREE.Vector3(0, 0, 0) },
    uBreath: { value: 0 },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;

/**
 * Pure additive blending (ONE, ONE). Every additive layer writes colour
 * already multiplied by its own coverage, so three's AdditiveBlending
 * (SRC_ALPHA, ONE) would double-attenuate it.
 */
export const ADDITIVE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
  transparent: true,
  depthTest: false,
  depthWrite: false,
} as const;
