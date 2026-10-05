import * as THREE from 'three';

export interface FieldSource {
  name: string;
  url: string;
  /** Painted vortex centre in image pixels (top-left origin, 1024 px). */
  centerPx: [number, number];
}

const base = import.meta.env.BASE_URL;

/**
 * The three source paintings. They ship inside the app bundle and are
 * never fetched from the network. Centres were measured by eye so the
 * shader's vortex spins around the vortex that is actually painted.
 */
export const FIELD_SOURCES: FieldSource[] = [
  { name: 'Galactic Swirl I', url: `${base}fields/Galactic_Swirl_1.png`, centerPx: [512, 457] },
  { name: 'Galactic Swirl II', url: `${base}fields/Galactic_Swirl_2.png`, centerPx: [522, 417] },
  { name: 'Galactic Swirl III', url: `${base}fields/Galactic_Swirl_3.png`, centerPx: [497, 487] },
];

export interface LoadedField {
  source: FieldSource;
  texture: THREE.Texture;
  /** Vortex centre in GL texture space (bottom-left origin). */
  center: THREE.Vector2;
}

export class TextureField {
  fields: LoadedField[] = [];

  async load(renderer: THREE.WebGLRenderer, sources = FIELD_SOURCES): Promise<LoadedField[]> {
    const loader = new THREE.TextureLoader();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.fields = await Promise.all(
      sources.map(async (source) => {
        const texture = await loader.loadAsync(source.url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.MirroredRepeatWrapping;
        texture.wrapT = THREE.MirroredRepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = Math.min(4, maxAniso);
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        renderer.initTexture(texture);
        const img = texture.image as { width: number; height: number };
        const center = new THREE.Vector2(
          source.centerPx[0] / img.width,
          1 - source.centerPx[1] / img.height,
        );
        return { source, texture, center };
      }),
    );
    return this.fields;
  }
}
