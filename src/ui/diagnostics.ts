/**
 * Plain-text diagnostics for release testing (D overlay, C to copy).
 * Everything here is read locally from the browser engine; nothing is sent
 * anywhere. Copying puts text on the user's own clipboard only.
 */

export interface DiagnosticsData {
  preset: string;
  fps: number;
  avgFps: number | null;
  minFps: number | null;
  measuredSeconds: number;
  quality: string;
  qualityAuto: boolean;
  particles: { stars: number; dust: number; nodes: number; starDensity: number; dustDensity: number; nodeDensity: number };
  render: { width: number; height: number };
  gpu: string;
  seed: number;
  field: string;
}

let platform = navigator.platform || 'unknown';

/** Resolve the OS description once (Windows 11 reports itself as NT 10.0 in the UA). */
export function initPlatform() {
  const uaData = (navigator as unknown as {
    userAgentData?: { getHighEntropyValues(h: string[]): Promise<Record<string, string>> };
  }).userAgentData;
  const engine = /(Edg|Chrome)\/([\d.]+)/.exec(navigator.userAgent);
  const engineText = engine ? `${engine[1] === 'Edg' ? 'Edge/WebView2' : 'Chromium'} ${engine[2]}` : navigator.userAgent;
  platform = `${navigator.platform} · ${engineText}`;
  uaData
    ?.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'bitness'])
    .then((v) => {
      let os = `${v.platform} ${v.platformVersion}`;
      if (v.platform === 'Windows') {
        const major = Number((v.platformVersion || '0').split('.')[0]);
        os = `Windows ${major >= 13 ? '11' : major > 0 ? '10' : '(older)'} (platformVersion ${v.platformVersion})`;
      }
      platform = `${os} · ${v.architecture || '?'}${v.bitness ? `-${v.bitness}` : ''} · ${engineText}`;
    })
    .catch(() => undefined);
}

const f1 = (v: number | null) => (v === null ? 'n/a (measuring)' : v.toFixed(1));

export function formatDiagnostics(d: DiagnosticsData): string {
  const p = d.particles;
  const pct = (x: number) => `${Math.round(Math.min(1, x) * 100)}%`;
  return [
    'Soundwavian Field Diagnostics',
    `Version: ${__APP_VERSION__} (commit ${__BUILD_COMMIT__})`,
    `Preset: ${d.preset}`,
    `FPS: ${d.fps.toFixed(1)}`,
    `Average FPS: ${f1(d.avgFps)} (over ${Math.max(0, d.measuredSeconds).toFixed(0)} s since preset change)`,
    `Minimum FPS: ${f1(d.minFps)} (lowest 2 s average)`,
    `Frame Time: ${d.fps > 0 ? (1000 / d.fps).toFixed(2) : 'n/a'} ms`,
    `Quality: ${d.quality}${d.qualityAuto ? ' (auto)' : ' (fixed)'}`,
    `Particle Count: ${p.stars + p.dust + p.nodes} allocated (stars ${p.stars} @ ${pct(p.starDensity)}, dust ${p.dust} @ ${pct(p.dustDensity)}, nodes ${p.nodes} @ ${pct(p.nodeDensity)} visible density)`,
    `Render Resolution: ${d.render.width}x${d.render.height}`,
    `Display Resolution: ${window.screen.width}x${window.screen.height} CSS px (${Math.round(window.screen.width * (window.devicePixelRatio || 1))}x${Math.round(window.screen.height * (window.devicePixelRatio || 1))} device px)`,
    `DPR: ${(window.devicePixelRatio || 1).toFixed(2)}`,
    `GPU: ${d.gpu}`,
    `OS/Platform: ${platform}`,
    `Field: ${d.field} · seed ${d.seed}`,
  ].join('\n');
}

/** Copy to the local clipboard. Falls back to execCommand where the async API is refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
