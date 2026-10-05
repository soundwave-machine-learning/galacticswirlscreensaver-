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
    uPixelsPerUnit: { value: 500 },
    uTex: { value: null as THREE.Texture | null },
    uTexCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uCover: { value: 4 },
  };
}

export type SharedUniforms = ReturnType<typeof createSharedUniforms>;
