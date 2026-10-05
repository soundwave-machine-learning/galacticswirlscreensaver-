import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import downFrag from '../shaders/bloomDown.frag?raw';
import upFrag from '../shaders/bloomUp.frag?raw';
import compositeFrag from '../shaders/composite.frag?raw';

export interface PostSettings {
  exposure: number;
  bloomStrength: number;
  bloomThreshold: number;
  vignette: number;
  grain: number;
  chromaticAberration: number;
  fade: number;
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * HDR scene target -> bloom mip chain -> composite to the canvas.
 * The scene may render below canvas resolution (quality renderScale);
 * grain and dither are always applied at native canvas resolution.
 */
export class PostFX {
  readonly sceneTarget: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly downMat: THREE.ShaderMaterial;
  private readonly upMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly type: THREE.TextureDataType;
  private levels = 5;
  private width = 1;
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const floatOk = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.type = floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.sceneTarget = this.makeTarget(1, 1, 0);

    this.downMat = pass(downFrag, {
      uSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 0.7 },
      uKnee: { value: 0.25 },
      uFirst: { value: 1 },
    });
    this.upMat = pass(upFrag, {
      uLow: { value: null },
      uCur: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1.0 },
    });
    this.compositeMat = pass(compositeFrag, {
      uScene: { value: this.sceneTarget.texture },
      uBloom: { value: null },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1 },
      uBloomStrength: { value: 0.2 },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.02 },
      uChromatic: { value: 0.3 },
      uGrainTime: { value: 0 },
      uFade: { value: 1 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private makeTarget(w: number, h: number, samples: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: this.type,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      samples,
    });
  }

  /** Scene size in pixels plus quality knobs. Rebuilds the bloom chain. */
  configure(sceneW: number, sceneH: number, levels: number, msaa: number) {
    this.width = sceneW;
    this.height = sceneH;
    this.levels = levels;
    this.sceneTarget.setSize(sceneW, sceneH);
    const samples = this.type === THREE.HalfFloatType ? msaa : 0;
    if (this.sceneTarget.samples !== samples) {
      this.sceneTarget.samples = samples;
      this.sceneTarget.dispose(); // re-allocated with the new sample count on next use
    }
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = [];
    this.up = [];
    let w = sceneW;
    let h = sceneH;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.down.push(this.makeTarget(w, h, 0));
      if (i < levels - 1) this.up.push(this.makeTarget(w, h, 0));
    }
    this.compositeMat.uniforms.uAspect.value.set(sceneW / Math.min(sceneW, sceneH), sceneH / Math.min(sceneW, sceneH));
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  private blit(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  render(s: PostSettings, grainTime: number) {
    // Bloom: down chain
    let src: THREE.Texture = this.sceneTarget.texture;
    let srcW = this.width;
    let srcH = this.height;
    const dm = this.downMat.uniforms;
    dm.uThreshold.value = s.bloomThreshold;
    for (let i = 0; i < this.down.length; i++) {
      dm.uSrc.value = src;
      dm.uTexel.value.set(1 / srcW, 1 / srcH);
      dm.uFirst.value = i === 0 ? 1 : 0;
      this.blit(this.downMat, this.down[i]);
      src = this.down[i].texture;
      srcW = this.down[i].width;
      srcH = this.down[i].height;
    }
    // Up chain
    const um = this.upMat.uniforms;
    let low: THREE.WebGLRenderTarget = this.down[this.down.length - 1];
    for (let i = this.up.length - 1; i >= 0; i--) {
      um.uLow.value = low.texture;
      um.uCur.value = this.down[i].texture;
      um.uTexel.value.set(1 / low.width, 1 / low.height);
      this.blit(this.upMat, this.up[i]);
      low = this.up[i];
    }
    const bloomTex = (this.up[0] ?? this.down[0]).texture;

    const cu = this.compositeMat.uniforms;
    cu.uScene.value = this.sceneTarget.texture;
    cu.uBloom.value = bloomTex;
    cu.uExposure.value = s.exposure;
    // Bloom is accumulated across levels; normalise so strength stays comparable.
    cu.uBloomStrength.value = s.bloomStrength / Math.max(1, this.levels * 0.5);
    cu.uVignette.value = s.vignette;
    cu.uGrain.value = s.grain;
    cu.uChromatic.value = s.chromaticAberration;
    cu.uGrainTime.value = grainTime;
    cu.uFade.value = s.fade;
    this.blit(this.compositeMat, null);
  }

  dispose() {
    this.sceneTarget.dispose();
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.compositeMat.dispose();
    this.quad.geometry.dispose();
  }
}
