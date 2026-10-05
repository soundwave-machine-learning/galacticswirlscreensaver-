/**
 * Host bridge. In the Windows app (Tauri/WebView2) calls go to a handful of
 * local Rust commands; in a plain browser they fall back to web APIs.
 * Nothing here touches the network.
 */
import { invoke } from '@tauri-apps/api/core';

export const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type LaunchMode = 'app' | 'screensaver' | 'preview' | 'config';

export interface LaunchInfo {
  mode: LaunchMode;
  /** Monitor index in screensaver mode (0 = primary). */
  display: number;
  seed: number | null;
  capture: boolean;
  debug: boolean;
  /** Optional overrides (not persisted): ?preset=orbit&quality=high */
  preset: string | null;
  quality: string | null;
}

export function readLaunchInfo(): LaunchInfo {
  const q = new URLSearchParams(location.search);
  const m = q.get('mode');
  const mode: LaunchMode =
    m === 'screensaver' || m === 'preview' || m === 'config' ? m : 'app';
  const seedParam = q.get('seed');
  const seed = seedParam !== null && /^\d+$/.test(seedParam) ? Number(seedParam) : null;
  return {
    mode,
    display: Number(q.get('display') ?? 0) || 0,
    seed,
    capture: q.has('capture'),
    debug: q.has('debug'),
    preset: q.get('preset'),
    quality: q.get('quality'),
  };
}

const STORAGE_KEY = 'soundwavian-field/settings';

export async function loadSettingsJson(): Promise<string | null> {
  if (isDesktopApp) {
    try {
      return await invoke<string | null>('load_settings');
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function saveSettingsJson(json: string): Promise<void> {
  if (isDesktopApp) {
    await invoke('save_settings', { json });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* storage unavailable (private window) - settings simply don't persist */
  }
}

/** Ends the process (desktop) - used when the screensaver is dismissed. */
export async function exitApp(): Promise<void> {
  if (isDesktopApp) {
    await invoke('exit_app');
    return;
  }
  // Browser test mode: drop back to the interactive app.
  const url = new URL(location.href);
  url.searchParams.delete('mode');
  location.replace(url.toString());
}

export async function isFullscreen(): Promise<boolean> {
  if (isDesktopApp) return invoke<boolean>('is_fullscreen');
  return document.fullscreenElement !== null;
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (isDesktopApp) {
    await invoke('set_fullscreen', { fullscreen: on });
    return;
  }
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* fullscreen refused (needs a user gesture) */
  }
}

export async function toggleFullscreen(): Promise<void> {
  await setFullscreen(!(await isFullscreen()));
}

/** Windows only: point the per-user screen saver setting at our .scr. */
export async function useAsScreensaver(): Promise<string> {
  if (!isDesktopApp) throw new Error('Only available in the installed Windows app.');
  return invoke<string>('use_as_screensaver');
}

/** Windows only: open the standard Screen Saver Settings dialog. */
export async function openScreensaverSettings(): Promise<void> {
  if (!isDesktopApp) throw new Error('Only available in the installed Windows app.');
  await invoke('open_screensaver_settings');
}
