import { readLaunchInfo, isDesktopApp, toggleFullscreen, setFullscreen, isFullscreen, exitApp } from './platform/host';
import { Scene } from './renderer/Scene';
import { AdaptiveQuality, describeGpu, suggestQuality } from './renderer/Quality';
import { TextureField } from './systems/TextureField';
import { ControlsPanel } from './ui/Controls';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from './platform/settings';
import { applyControls, getPreset, PRESETS, QUALITY_LEVELS, type QualityLevel } from './config/presets';
import { deriveSeed, randomSeed } from './util/random';
import { useAsScreensaver, openScreensaverSettings } from './platform/host';

const launch = readLaunchInfo();

function fatal(message: string) {
  const div = document.createElement('div');
  div.className = 'fatal';
  div.textContent = message;
  document.body.append(div);
}

export async function boot() {
  const canvas = document.getElementById('field') as HTMLCanvasElement;
  const settings: Settings = await loadSettings();
  if (launch.preset) settings.preset = getPreset(launch.preset).id;
  if (launch.quality && QUALITY_LEVELS.includes(launch.quality as QualityLevel)) {
    settings.quality = launch.quality as QualityLevel;
  }
  const interactive = launch.mode === 'app' || launch.mode === 'config';

  // Seed: URL > saved fixed seed > fresh random. Each monitor gets its own.
  const baseSeed = launch.seed ?? settings.seed ?? randomSeed();
  const seed = launch.display > 0 ? deriveSeed(baseSeed, `display-${launch.display}`) % 1_000_000 : baseSeed;

  const effective = () =>
    applyControls(getPreset(settings.preset).params, settings.controls, {
      matrix: settings.matrix,
      particles: settings.particles,
    });

  // The screen-saver preview and config window are small: keep them light.
  const forced: QualityLevel | null = launch.mode === 'preview' ? 'low' : launch.mode === 'config' ? 'medium' : null;

  let scene: Scene;
  try {
    scene = new Scene(canvas, {
      seed,
      quality: forced ?? (settings.quality === 'auto' ? 'medium' : settings.quality),
      params: effective(),
    });
  } catch (err) {
    fatal('WebGL 2 is not available on this display adapter.');
    console.error(err);
    return;
  }
  scene.setToggles(settings.matrix, settings.particles);

  const quality = new AdaptiveQuality(
    forced ?? settings.quality,
    forced ?? suggestQuality(scene.renderer, canvas.clientWidth, canvas.clientHeight),
    (level) => scene.setQuality(level),
  );
  scene.setQuality(quality.level);

  const textures = new TextureField();
  try {
    scene.setFields(await textures.load(scene.renderer));
  } catch (err) {
    fatal('The source images could not be loaded.');
    console.error(err);
    return;
  }

  window.addEventListener('resize', () => scene.resize());

  let paused = false;
  const persist = () => {
    if (interactive) void saveSettings(settings);
  };
  const retarget = () => {
    scene.target = effective();
    scene.setToggles(settings.matrix, settings.particles);
  };

  // ---- interface (app + config only; the screensaver shows nothing) ----
  let panel: ControlsPanel | null = null;
  if (interactive && !launch.capture) {
    panel = new ControlsPanel(
      document.body,
      {
        onPreset: (id) => {
          settings.preset = id;
          retarget();
          panel?.sync(settings);
          persist();
        },
        onControl: (key, value) => {
          settings.controls[key] = value;
          retarget();
          persist();
        },
        onQuality: (q) => {
          settings.quality = q;
          quality.setSetting(forced ?? q);
          persist();
        },
        onPause: () => (paused = !paused),
        onNext: () => scene.nextField(),
        onFullscreen: () => void toggleFullscreen(),
        onRandomize: () => scene.reseed(randomSeed()),
        onToggleMatrix: (on) => {
          settings.matrix = on;
          retarget();
          persist();
        },
        onToggleParticles: (on) => {
          settings.particles = on;
          retarget();
          persist();
        },
        ...(launch.mode === 'config' || isDesktopApp
          ? {
              onDisplays: (v: Settings['displays']) => {
                settings.displays = v;
                persist();
              },
              onUseAsScreensaver: async () => {
                try {
                  await saveSettings(settings, true);
                  const path = await useAsScreensaver();
                  panel?.flash(`Screen saver set to ${path}`);
                } catch (e) {
                  panel?.flash(String(e));
                }
              },
              onOpenScreensaverSettings: async () => {
                try {
                  await openScreensaverSettings();
                } catch (e) {
                  panel?.flash(String(e));
                }
              },
              onResetDefaults: () => {
                Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
                retarget();
                quality.setSetting(forced ?? settings.quality);
                panel?.sync(settings);
                persist();
              },
              ...(launch.mode === 'config'
                ? {
                    onClose: async () => {
                      await saveSettings(settings, true);
                      await exitApp();
                    },
                  }
                : {}),
            }
          : {}),
      },
      { configMode: launch.mode === 'config', windowsSection: launch.mode === 'config' || isDesktopApp },
    );
    panel.sync(settings);
  }

  // ---- keyboard (app mode) ----
  const stats = document.createElement('div');
  stats.id = 'stats';
  document.body.append(stats);
  if (launch.debug) stats.classList.add('on');

  if (interactive) {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.key) {
        case ' ':
          paused = !paused;
          break;
        case 'f':
        case 'F':
          if (launch.mode === 'app') void toggleFullscreen();
          break;
        case 'Escape':
          if (launch.mode === 'app') void isFullscreen().then((fs) => (fs ? setFullscreen(false) : undefined));
          break;
        case 'ArrowRight':
          scene.nextField();
          break;
        case 'm':
        case 'M':
          settings.matrix = !settings.matrix;
          retarget();
          panel?.sync(settings);
          persist();
          break;
        case 'p':
        case 'P':
          settings.particles = !settings.particles;
          retarget();
          panel?.sync(settings);
          persist();
          break;
        case 'r':
        case 'R':
          scene.reseed(randomSeed());
          break;
        case 'd':
        case 'D':
          stats.classList.toggle('on');
          break;
        default: {
          const n = Number(e.key);
          if (n >= 1 && n <= PRESETS.length) {
            settings.preset = PRESETS[n - 1].id;
            retarget();
            panel?.sync(settings);
            persist();
          } else return;
        }
      }
      e.preventDefault();
    });
  }

  // ---- deterministic offline stepping for previews/tests: ?capture ----
  if (launch.capture) {
    const w = window as unknown as Record<string, unknown>;
    scene.transitionSpeed = settings.controls.transitionSpeed;
    w.__advance = (seconds: number, step = 1 / 30) => {
      for (let t = 0; t < seconds - 1e-9; t += step) scene.update(step, step);
      scene.render();
    };
    w.__scene = scene;
    w.__ready = true;
    scene.update(1 / 30, 1 / 30);
    scene.render();
    return;
  }

  // ---- main loop ----
  // Frame meter for the D overlay (release testing): average fps and the
  // lowest 2-second average since the preset last changed. The first 5 s
  // after a change are ignored (shader warm-up, parameter easing).
  const gpu = describeGpu(scene.renderer);
  const meter = { preset: settings.preset, time: 0, frames: 0, winTime: 0, winFrames: 0, min: Infinity };
  const measure = (dt: number) => {
    if (meter.preset !== settings.preset) {
      Object.assign(meter, { preset: settings.preset, time: 0, frames: 0, winTime: 0, winFrames: 0, min: Infinity });
    }
    meter.time += dt;
    if (meter.time < 5 || dt <= 0) return;
    meter.frames++;
    meter.winTime += dt;
    meter.winFrames++;
    if (meter.winTime >= 2) {
      meter.min = Math.min(meter.min, meter.winFrames / meter.winTime);
      meter.winTime = 0;
      meter.winFrames = 0;
    }
  };

  let last = performance.now();
  let statsTimer = 0;
  const frame = (now: number) => {
    const realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    quality.sample(realDt);
    measure(realDt);

    scene.transitionSpeed = settings.controls.transitionSpeed;
    scene.update(paused ? 0 : realDt, realDt);
    scene.render();

    statsTimer -= realDt;
    if (statsTimer <= 0) {
      statsTimer = 0.5;
      panel?.setStatus({
        paused,
        fieldName: scene.fieldName,
        seed: scene.currentSeed,
        fps: quality.fps,
        quality: scene.currentQuality + (quality.isAuto ? ' (auto)' : ''),
      });
      if (stats.classList.contains('on')) {
        const d = scene.debug;
        const measured = meter.time - 5;
        const avg = measured > 0 && meter.frames > 0 ? (meter.frames / measured).toFixed(1) : '…';
        const min = Number.isFinite(meter.min) ? meter.min.toFixed(1) : '…';
        stats.textContent =
          `${quality.fps.toFixed(1)} fps   ${d.quality}${quality.isAuto ? ' auto' : ''}\n` +
          `${getPreset(settings.preset).label}: avg ${avg}  min ${min}  over ${Math.max(0, measured).toFixed(0)}s\n` +
          `gpu ${gpu}\n` +
          `screen ${window.screen.width}×${window.screen.height} @${(window.devicePixelRatio || 1).toFixed(2)}x  ` +
          `scene ${d.size.width}×${d.size.height}\n` +
          `field ${d.field} → ${d.next}  ${d.phase}  mix ${d.mix.toFixed(3)}\n` +
          `emergence ${d.emergence.toFixed(3)}  next in ${d.timeToNext.toFixed(0)}s\n` +
          `links ${d.links}   seed ${d.seed}${paused ? '   PAUSED' : ''}`;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function reportFatal(err: unknown) {
  console.error(err);
  fatal('Soundwavian Field could not start.');
}
