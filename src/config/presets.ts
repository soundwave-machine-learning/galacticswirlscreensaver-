/**
 * Every animation parameter lives here. Presets are complete parameter sets;
 * user controls are multipliers applied on top (see `applyControls`). The
 * runtime never snaps between values - `ParamBlender` eases toward targets.
 */

export interface FieldParams {
  // Spiral field
  vortexStrength: number; // rad/s of differential (flow) spin at the core
  vortexRadius: number; // falloff radius, field units (1 = half the short screen side)
  twistAmount: number; // bounded oscillating twist at the core, rad
  rotationSpeed: number; // peak uniform rotation of the whole field, rad/s
  centerX: number;
  centerY: number;
  noiseAmount: number; // organic domain warp, field units
  chromaticDispersion: number; // per-channel twist spread
  textureZoom: number;

  // Breathing
  breathingAmount: number; // 0..1, 1 = full design range (~5-8% max variation)
  breathingPeriod: number; // seconds

  // Grade of the source painting
  exposure: number;
  contrast: number;
  saturation: number;
  highlightLift: number; // gold/cyan lift of highlights
  voidAmount: number; // 0..1, carve the painting into near-black fragments

  // Galactic matrix layer
  matrixOpacity: number; // base perceptual opacity, ~0.03-0.12
  matrixReveal: number; // how much it occasionally clarifies
  sphereGrid: number; // weight of the celestial-sphere graticule
  glyphs: number; // weight of numeric markers / glyphs

  // Particles
  stars: number; // visible fraction 0..1
  dust: number;
  nodes: number;
  particleBrightness: number;
  connections: number; // max simultaneous constellation lines

  // Post
  bloomStrength: number;
  bloomThreshold: number;
  vignette: number;
  grain: number;
  chromaticAberration: number;

  // Camera drift
  zoomDrift: number; // fraction, 0.005-0.02
  rollDrift: number; // rad
  panDrift: number; // field units
}

export type PresetId = 'stillness' | 'orbit' | 'deep-field' | 'ascension' | 'void';

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
  params: FieldParams;
}

const STILLNESS: FieldParams = {
  vortexStrength: 0.0045,
  vortexRadius: 0.5,
  twistAmount: 0.16,
  rotationSpeed: 0.0016,
  centerX: 0,
  centerY: 0,
  noiseAmount: 0.012,
  chromaticDispersion: 0.025,
  textureZoom: 1.0,

  breathingAmount: 0.65,
  breathingPeriod: 12,

  exposure: 0.92,
  contrast: 1.04,
  saturation: 0.95,
  highlightLift: 0.0,
  voidAmount: 0.0,

  matrixOpacity: 0.035,
  matrixReveal: 0.45,
  sphereGrid: 0.6,
  glyphs: 0.5,

  stars: 0.45,
  dust: 0.3,
  nodes: 0.35,
  particleBrightness: 0.8,
  connections: 5,

  bloomStrength: 0.18,
  bloomThreshold: 0.72,
  vignette: 0.35,
  grain: 0.022,
  chromaticAberration: 0.25,

  zoomDrift: 0.008,
  rollDrift: 0.006,
  panDrift: 0.01,
};

export const PRESETS: Preset[] = [
  {
    id: 'stillness',
    label: 'Stillness',
    description: 'Very slow. Minimal particles. Almost invisible matrix. Weak vortex.',
    params: STILLNESS,
  },
  {
    id: 'orbit',
    label: 'Orbit',
    description: 'Moderate rotating field. Visible orbital geometry. Balanced particles.',
    params: {
      ...STILLNESS,
      vortexStrength: 0.009,
      vortexRadius: 0.6,
      twistAmount: 0.3,
      rotationSpeed: 0.0032,
      noiseAmount: 0.016,
      chromaticDispersion: 0.035,
      breathingAmount: 0.8,
      breathingPeriod: 11,
      exposure: 0.95,
      matrixOpacity: 0.085,
      matrixReveal: 0.6,
      sphereGrid: 1.0,
      glyphs: 0.9,
      stars: 0.7,
      dust: 0.6,
      nodes: 0.7,
      particleBrightness: 1.0,
      connections: 10,
      bloomStrength: 0.22,
      zoomDrift: 0.012,
      rollDrift: 0.01,
      panDrift: 0.014,
    },
  },
  {
    id: 'deep-field',
    label: 'Deep Field',
    description: 'Darkest mode. Dense star depth. Minimal geometry.',
    params: {
      ...STILLNESS,
      vortexStrength: 0.004,
      twistAmount: 0.14,
      rotationSpeed: 0.0012,
      noiseAmount: 0.01,
      exposure: 0.34,
      contrast: 1.32,
      saturation: 0.78,
      matrixOpacity: 0.025,
      matrixReveal: 0.3,
      sphereGrid: 0.35,
      glyphs: 0.25,
      stars: 1.0,
      dust: 0.55,
      nodes: 0.3,
      particleBrightness: 1.25,
      connections: 4,
      bloomStrength: 0.24,
      bloomThreshold: 0.55,
      vignette: 0.6,
      grain: 0.02,
      zoomDrift: 0.01,
    },
  },
  {
    id: 'ascension',
    label: 'Ascension',
    description: 'Brighter gold/cyan energy. Stronger breathing. Moderate vortex.',
    params: {
      ...STILLNESS,
      vortexStrength: 0.008,
      vortexRadius: 0.58,
      twistAmount: 0.26,
      rotationSpeed: 0.0026,
      noiseAmount: 0.015,
      chromaticDispersion: 0.04,
      breathingAmount: 1.0,
      breathingPeriod: 10,
      exposure: 1.06,
      contrast: 1.02,
      saturation: 1.06,
      highlightLift: 0.55,
      matrixOpacity: 0.06,
      matrixReveal: 0.6,
      sphereGrid: 0.8,
      glyphs: 0.7,
      stars: 0.6,
      dust: 0.75,
      nodes: 0.75,
      particleBrightness: 1.25,
      connections: 12,
      bloomStrength: 0.34,
      bloomThreshold: 0.6,
      vignette: 0.3,
      zoomDrift: 0.014,
    },
  },
  {
    id: 'void',
    label: 'Void',
    description: 'Near-black negative space. Only fragments of the painting and sparse nodes remain.',
    params: {
      ...STILLNESS,
      vortexStrength: 0.005,
      twistAmount: 0.2,
      rotationSpeed: 0.0014,
      noiseAmount: 0.014,
      exposure: 0.85,
      contrast: 1.15,
      saturation: 0.9,
      voidAmount: 1.0,
      matrixOpacity: 0.04,
      matrixReveal: 0.5,
      sphereGrid: 0.5,
      glyphs: 0.45,
      stars: 0.25,
      dust: 0.12,
      nodes: 0.45,
      particleBrightness: 0.9,
      connections: 6,
      bloomStrength: 0.2,
      bloomThreshold: 0.5,
      vignette: 0.5,
    },
  },
];

export const DEFAULT_PRESET: PresetId = 'stillness';

export function getPreset(id: string | null | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** User-facing controls. All are multipliers; 1 = preset as designed. */
export interface Controls {
  intensity: number; // 0..2
  spiral: number; // 0..2
  matrix: number; // 0..2
  particles: number; // 0..2
  breathing: number; // 0..2
  transitionSpeed: number; // 0.25..3
  brightness: number; // 0.5..1.5
}

export const DEFAULT_CONTROLS: Controls = {
  intensity: 1,
  spiral: 1,
  matrix: 1,
  particles: 1,
  breathing: 1,
  transitionSpeed: 1,
  brightness: 1,
};

export const CONTROL_RANGES: Record<keyof Controls, { min: number; max: number; label: string }> = {
  intensity: { min: 0, max: 2, label: 'Intensity' },
  spiral: { min: 0, max: 2, label: 'Spiral' },
  matrix: { min: 0, max: 2, label: 'Matrix' },
  particles: { min: 0, max: 2, label: 'Particles' },
  breathing: { min: 0, max: 2, label: 'Breathing' },
  transitionSpeed: { min: 0.25, max: 3, label: 'Transition Speed' },
  brightness: { min: 0.5, max: 1.5, label: 'Brightness' },
};

/** Effective parameters = preset shaped by the user's controls and toggles. */
export function applyControls(
  p: FieldParams,
  c: Controls,
  toggles: { matrix: boolean; particles: boolean },
): FieldParams {
  const i = c.intensity;
  const soft = (x: number) => 0.5 + 0.5 * x; // half-strength coupling
  const m = toggles.matrix ? c.matrix : 0;
  const pt = toggles.particles ? c.particles : 0;
  return {
    ...p,
    vortexStrength: p.vortexStrength * c.spiral * soft(i),
    twistAmount: p.twistAmount * c.spiral * soft(i),
    rotationSpeed: p.rotationSpeed * (0.5 + 0.5 * c.spiral),
    noiseAmount: p.noiseAmount * i,
    chromaticDispersion: p.chromaticDispersion * i,
    breathingAmount: Math.min(1.6, p.breathingAmount * c.breathing),
    exposure: p.exposure * c.brightness,
    highlightLift: p.highlightLift * soft(i),
    matrixOpacity: p.matrixOpacity * m,
    glyphs: p.glyphs * m,
    stars: Math.min(1, p.stars * pt),
    dust: Math.min(1, p.dust * pt),
    nodes: Math.min(1, p.nodes * pt),
    particleBrightness: p.particleBrightness * Math.min(1.4, 0.6 + 0.4 * pt) * (pt > 0 ? 1 : 0),
    connections: Math.round(p.connections * Math.min(1.5, pt)),
    bloomStrength: p.bloomStrength * soft(i),
    chromaticAberration: p.chromaticAberration * soft(i),
  };
}

// ---------------------------------------------------------------------------
// Quality

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export interface QualitySpec {
  /** Upper bound on device pixel ratio used for the canvas. */
  maxDpr: number;
  /** Scene render scale relative to the canvas (post output stays native). */
  renderScale: number;
  stars: number;
  dust: number;
  nodes: number;
  fbmOctaves: number;
  bloomLevels: number;
  msaa: number;
}

export const QUALITY: Record<QualityLevel, QualitySpec> = {
  low: { maxDpr: 1, renderScale: 0.6, stars: 1200, dust: 400, nodes: 24, fbmOctaves: 2, bloomLevels: 3, msaa: 0 },
  medium: { maxDpr: 1, renderScale: 0.8, stars: 3000, dust: 1000, nodes: 36, fbmOctaves: 3, bloomLevels: 4, msaa: 0 },
  high: { maxDpr: 1.5, renderScale: 1.0, stars: 6000, dust: 2000, nodes: 48, fbmOctaves: 4, bloomLevels: 5, msaa: 2 },
  ultra: { maxDpr: 2, renderScale: 1.0, stars: 10000, dust: 3500, nodes: 64, fbmOctaves: 5, bloomLevels: 6, msaa: 4 },
};

// ---------------------------------------------------------------------------
// Timing

export const TIMING = {
  holdSeconds: [90, 180] as [number, number],
  transitionSeconds: [30, 60] as [number, number],
  /** Incoming field starts seeding particles / distortion this long before its transition. */
  anticipationSeconds: 18,
  /** "Next Field" transition length (seconds, before transition-speed scaling). */
  manualTransitionSeconds: 14,
  /** How long parameter changes take to settle (time constant, seconds). */
  paramSettle: 2.5,
  uiHideAfterMs: 3000,
  cursorHideAfterMs: 3000,
  flowPeriod: 22,
};

// ---------------------------------------------------------------------------
// Particle populations (counts come from the quality level)

export interface PopulationSpec {
  name: 'stars' | 'dust';
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
  /** Fraction of particles that orbit against the main vortex. */
  counterSpin: number;
  /** How strongly this layer heralds an incoming painting. */
  emergeBoost: number;
}

export const POPULATIONS: Record<'stars' | 'dust', PopulationSpec> = {
  // Layer 1: small distant stars - deep, slow, tiny, faint parallax.
  stars: {
    name: 'stars',
    depth: [2.5, 9],
    size: [0.0016, 0.0042],
    life: [160, 520],
    radiusMax: 2.4,
    speed: 0.0045,
    inflow: 0,
    tint: 0.28,
    twinkle: 0.35,
    softness: 0.0,
    brightness: 0.85,
    counterSpin: 0.32,
    emergeBoost: 0.4,
  },
  // Layer 2: slow dust - closer, soft, coloured by the painting, drifting inward.
  dust: {
    name: 'dust',
    depth: [0.65, 2.6],
    size: [0.004, 0.022],
    life: [70, 240],
    radiusMax: 2.1,
    speed: 0.0105,
    inflow: 0.0014,
    tint: 0.85,
    twinkle: 0.15,
    softness: 0.85,
    brightness: 0.42,
    counterSpin: 0.22,
    emergeBoost: 1.0,
  },
};
