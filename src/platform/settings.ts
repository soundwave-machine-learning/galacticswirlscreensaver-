import {
  DEFAULT_CONTROLS,
  DEFAULT_PRESET,
  PRESETS,
  QUALITY_LEVELS,
  type Controls,
  type PresetId,
  type QualityLevel,
} from '../config/presets';
import { loadSettingsJson, saveSettingsJson } from './host';

export type QualitySetting = 'auto' | QualityLevel;

export interface Settings {
  version: 1;
  preset: PresetId;
  controls: Controls;
  quality: QualitySetting;
  matrix: boolean;
  particles: boolean;
  /** null = a fresh random seed every launch. */
  seed: number | null;
  /** Screensaver: render on every monitor, or primary only (others black). */
  displays: 'all' | 'primary';
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  preset: DEFAULT_PRESET,
  controls: { ...DEFAULT_CONTROLS },
  quality: 'auto',
  matrix: true,
  particles: true,
  seed: null,
  displays: 'all',
};

/** Parse defensively: a corrupt settings file must never stop the screensaver. */
export function sanitize(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, controls: { ...DEFAULT_CONTROLS } };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.preset === 'string' && PRESETS.some((p) => p.id === r.preset)) s.preset = r.preset as PresetId;
  if (r.quality === 'auto' || QUALITY_LEVELS.includes(r.quality as QualityLevel)) s.quality = r.quality as QualitySetting;
  if (typeof r.matrix === 'boolean') s.matrix = r.matrix;
  if (typeof r.particles === 'boolean') s.particles = r.particles;
  if (r.seed === null || (typeof r.seed === 'number' && Number.isFinite(r.seed))) s.seed = r.seed as number | null;
  if (r.displays === 'all' || r.displays === 'primary') s.displays = r.displays;
  if (r.controls && typeof r.controls === 'object') {
    const c = r.controls as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_CONTROLS) as (keyof Controls)[]) {
      const v = c[key];
      if (typeof v === 'number' && Number.isFinite(v)) s.controls[key] = Math.min(3, Math.max(0, v));
    }
  }
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const json = await loadSettingsJson();
  if (!json) return sanitize(null);
  try {
    return sanitize(JSON.parse(json));
  } catch {
    return sanitize(null);
  }
}

let saveTimer: number | undefined;

/** Debounced save so dragging a slider doesn't hammer the disk. */
export function saveSettings(s: Settings, immediate = false): Promise<void> {
  window.clearTimeout(saveTimer);
  const write = () => saveSettingsJson(JSON.stringify(s, null, 2)).catch(() => undefined);
  if (immediate) return write();
  return new Promise((resolve) => {
    saveTimer = window.setTimeout(() => write().then(resolve), 600);
  });
}
