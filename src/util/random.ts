/** Deterministic seeded PRNG (mulberry32). Same seed -> same field. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent stream from a base seed and a label. */
export function deriveSeed(seed: number, label: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % 1_000_000;
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Quintic ease - zero first and second derivative at both ends. */
export const smootherstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
/** Frame-rate independent exponential approach. */
export const approach = (current: number, target: number, dt: number, tau: number) =>
  target + (current - target) * Math.exp(-dt / Math.max(tau, 1e-4));

/**
 * Smooth 1D value noise in [0, 1] - used for slow envelopes ("occasionally
 * becomes clearer, then disappears again"). Knots every `period` seconds.
 */
export class SlowEnvelope {
  private knots: number[];

  constructor(
    seed: number,
    private readonly period: number,
    count = 64,
  ) {
    const rand = mulberry32(seed);
    this.knots = Array.from({ length: count }, () => rand());
  }

  value(t: number): number {
    const x = t / this.period;
    const i = Math.floor(x);
    const f = x - i;
    const n = this.knots.length;
    const a = this.knots[((i % n) + n) % n];
    const b = this.knots[(((i + 1) % n) + n) % n];
    return lerp(a, b, smootherstep(f));
  }
}
