import type * as THREE from 'three';
import { QUALITY_LEVELS, type QualityLevel } from '../config/presets';
import type { QualitySetting } from '../platform/settings';

/** Best-effort GPU description (no fingerprinting leaves the machine). */
export function describeGpu(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* ignore */
  }
  return String(gl.getParameter(gl.RENDERER));
}

/** Initial level from GPU class and the number of pixels we would draw. */
export function suggestQuality(renderer: THREE.WebGLRenderer, cssW: number, cssH: number): QualityLevel {
  const gpu = describeGpu(renderer).toLowerCase();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const megapixels = (cssW * cssH * dpr * dpr) / 1e6;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(gpu)) return 'low';
  const discrete = /nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|arc a|apple m\d/.test(gpu);
  if (discrete) return megapixels > 9 ? 'medium' : 'high';
  // Integrated graphics (Intel UHD/Iris, AMD APUs, unknown).
  return megapixels > 3.2 ? 'low' : 'medium';
}

/**
 * Keeps the field at ~60 fps. Frame pacing is vsync-limited, so it cannot
 * measure headroom; instead it starts from a conservative guess, steps down
 * on sustained drops, and probes back up (at most to the starting level)
 * only after minutes of clean frames. A level that fails twice is capped.
 */
export class AdaptiveQuality {
  level: QualityLevel;
  fps = 60;

  private readonly ceilingAuto: QualityLevel;
  private ceiling: QualityLevel;
  private windowTime = 0;
  private windowFrames = 0;
  private windowWorst = 0;
  private badWindows = 0;
  private cleanTime = 0;
  private cooldown = 4; // ignore start-up (shader compiles, texture uploads)
  private failures: Partial<Record<QualityLevel, number>> = {};

  constructor(
    private setting: QualitySetting,
    suggested: QualityLevel,
    private readonly onChange: (level: QualityLevel) => void,
  ) {
    this.ceilingAuto = suggested;
    this.ceiling = suggested;
    this.level = setting === 'auto' ? suggested : setting;
  }

  setSetting(setting: QualitySetting) {
    this.setting = setting;
    const target = setting === 'auto' ? this.ceiling : setting;
    this.change(target);
  }

  get isAuto() {
    return this.setting === 'auto';
  }

  private change(level: QualityLevel) {
    if (level === this.level) return;
    this.level = level;
    this.cooldown = 3;
    this.badWindows = 0;
    this.cleanTime = 0;
    this.onChange(level);
  }

  /** Feed every frame with the real frame interval in seconds. */
  sample(dt: number) {
    if (dt <= 0 || dt > 0.25) return; // tab switch, breakpoint, resume
    this.windowTime += dt;
    this.windowFrames++;
    this.windowWorst = Math.max(this.windowWorst, dt);
    if (this.windowTime < 2) return;

    const avg = this.windowTime / this.windowFrames;
    this.fps = 1 / avg;
    const worst = this.windowWorst;
    this.windowTime = 0;
    this.windowFrames = 0;
    this.windowWorst = 0;

    if (this.cooldown > 0) {
      this.cooldown -= 2;
      return;
    }
    if (!this.isAuto) return;

    const idx = QUALITY_LEVELS.indexOf(this.level);
    const struggling = avg > 1 / 52 || worst > 0.1;
    if (struggling) {
      this.cleanTime = 0;
      this.badWindows++;
      if (this.badWindows >= 2 && idx > 0) {
        const n = (this.failures[this.level] ?? 0) + 1;
        this.failures[this.level] = n;
        if (n >= 2) this.ceiling = QUALITY_LEVELS[idx - 1];
        this.change(QUALITY_LEVELS[idx - 1]);
      }
      return;
    }
    this.badWindows = 0;
    this.cleanTime += 2;
    const ceilIdx = QUALITY_LEVELS.indexOf(this.ceiling);
    if (idx < ceilIdx && this.cleanTime > 180) this.change(QUALITY_LEVELS[idx + 1]);
  }

  /** Never exceeds this in auto mode (exposed for the UI). */
  get autoCeiling() {
    return this.ceilingAuto;
  }
}
