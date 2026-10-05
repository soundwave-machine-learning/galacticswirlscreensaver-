import { approach } from '../util/random';

/**
 * Global slow modulation. Produces a smooth signal in [-1, 1] with a period
 * that itself wanders between roughly 9 and 13 seconds, and an asymmetric
 * shape (slower inhale, softer exhale) so the field breathes rather than
 * pulses. Consumers scale it by their own small amounts (<= ~8%).
 */
export class BreathingEngine {
  /** Smoothed breath value in [-1, 1]. */
  value = 0;
  /** 0..1 strength multiplier (preset * user slider). */
  amount = 1;

  private phase = 0.25;
  private elapsed = 0;

  constructor(private basePeriod = 11) {}

  setBasePeriod(seconds: number) {
    this.basePeriod = seconds;
  }

  update(dt: number) {
    this.elapsed += dt;
    // Period drifts slowly (+-18%) so the rhythm never feels mechanical.
    const drift =
      0.12 * Math.sin(this.elapsed * 0.0131) + 0.06 * Math.sin(this.elapsed * 0.0377 + 1.7);
    const period = this.basePeriod * (1 + drift);
    this.phase = (this.phase + dt / period) % 1;

    // Asymmetric waveform: inhale over 45% of the cycle, exhale over 55%.
    const p = this.phase;
    const k = 0.45;
    const warped = p < k ? (p / k) * 0.5 : 0.5 + ((p - k) / (1 - k)) * 0.5;
    const raw = -Math.cos(warped * Math.PI * 2);

    this.value = approach(this.value, raw, dt, 0.35);
  }

  /** Breath scaled to a fractional modulation: 1 + value * fraction * amount. */
  mod(fraction: number): number {
    return 1 + this.value * fraction * this.amount;
  }
}
