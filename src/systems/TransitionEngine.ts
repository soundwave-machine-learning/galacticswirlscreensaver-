import { TIMING } from '../config/presets';
import { approach, clamp, mulberry32, smootherstep } from '../util/random';

/**
 * Sequences the source paintings A -> B -> C -> A with long holds and long,
 * non-linear transitions. Exposes:
 *   current / next   indices of the dominant and incoming fields
 *   mix              eased 0..1 dominance of the incoming field
 *   emergence        0..1 bell curve: distortion + incoming particles. It
 *                    starts rising during the end of the hold, so the
 *                    incoming field is felt before it is seen.
 */
export class TransitionEngine {
  current = 0;
  next = 1;
  mix = 0;
  emergence = 0;
  /** Raw (un-eased) transition progress, 0 while holding. */
  progress = 0;

  private emergenceTarget = 0;
  private phase: 'hold' | 'transition' = 'hold';
  private elapsed = 0;
  private holdDuration = 120;
  private transitionDuration = 45;
  private rand: () => number;

  constructor(
    private readonly count: number,
    seed: number,
    start = 0,
  ) {
    this.rand = mulberry32(seed);
    this.current = start % count;
    this.next = (this.current + 1) % count;
    this.holdDuration = this.pick(TIMING.holdSeconds);
    // The very first hold is shorter so a fresh launch reaches a transition sooner.
    this.holdDuration *= 0.6;
  }

  private pick([a, b]: [number, number]) {
    return a + (b - a) * this.rand();
  }

  get state() {
    return this.phase;
  }

  /** Seconds until the next transition starts (0 during a transition). */
  get timeToNext() {
    return this.phase === 'hold' ? Math.max(0, this.holdDuration - this.elapsed) : 0;
  }

  /** dt is already scaled by the user's transition-speed control. */
  update(dt: number) {
    this.elapsed += dt;
    if (this.phase === 'hold') {
      if (this.elapsed >= this.holdDuration) {
        this.beginTransition(this.pick(TIMING.transitionSeconds));
      }
    } else if (this.elapsed >= this.transitionDuration) {
      this.current = this.next;
      this.next = (this.current + 1) % this.count;
      this.phase = 'hold';
      this.elapsed = 0;
      this.holdDuration = this.pick(TIMING.holdSeconds);
    }
    this.computeOutputs();
    // Smoothed so a manual "Next Field" never makes the distortion jump.
    this.emergence = approach(this.emergence, this.emergenceTarget, dt, 1.2);
  }

  /** Begin (or hurry) the move to the next field. Never snaps. */
  advance() {
    const target = TIMING.manualTransitionSeconds;
    if (this.phase === 'hold') {
      this.beginTransition(target);
      this.computeOutputs();
      return;
    }
    // Already transitioning: compress the remaining time, keeping progress.
    const remaining = this.transitionDuration - this.elapsed;
    if (remaining > target * 0.5) {
      const p = this.elapsed / this.transitionDuration;
      const newDuration = (target * 0.5) / Math.max(1e-3, 1 - p);
      this.transitionDuration = newDuration;
      this.elapsed = p * newDuration;
    }
  }

  private beginTransition(duration: number) {
    this.phase = 'transition';
    this.elapsed = 0;
    this.transitionDuration = duration;
  }

  private computeOutputs() {
    if (this.phase === 'hold') {
      this.progress = 0;
      this.mix = 0;
      // Anticipation: the incoming field begins to stir before its transition.
      const lead = TIMING.anticipationSeconds;
      const a = clamp((this.elapsed - (this.holdDuration - lead)) / lead, 0, 1);
      this.emergenceTarget = 0.35 * smootherstep(a);
    } else {
      const p = clamp(this.elapsed / this.transitionDuration, 0, 1);
      this.progress = p;
      this.mix = smootherstep(p);
      // Continues from the anticipation level (0.35), peaks at 40%, then settles.
      this.emergenceTarget =
        p < 0.4
          ? 0.35 + 0.65 * smootherstep(p / 0.4)
          : 1 - smootherstep((p - 0.4) / 0.6);
    }
  }
}
