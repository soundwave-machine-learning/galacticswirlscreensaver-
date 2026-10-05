import { exitApp } from './host';

/**
 * Screensaver semantics: any key, click, wheel, touch or real mouse
 * movement ends the screensaver. Installed before anything else (including
 * WebGL) so the screen can always be dismissed, even if rendering fails.
 */
export function installScreensaverGuard(opts: { graceMs?: number; moveThresholdPx?: number } = {}) {
  const grace = opts.graceMs ?? 900;
  const threshold = opts.moveThresholdPx ?? 10;
  const start = performance.now();
  let origin: { x: number; y: number } | null = null;
  let exiting = false;

  const quit = () => {
    if (exiting) return;
    exiting = true;
    document.documentElement.classList.add('exiting');
    void exitApp();
  };

  const ready = () => performance.now() - start > grace;

  const onMove = (e: MouseEvent | PointerEvent) => {
    // Windows (and WebView2) can emit a synthetic move as the window appears.
    if (!origin || !ready()) {
      origin = { x: e.screenX, y: e.screenY };
      return;
    }
    if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > threshold) quit();
  };
  const onInput = (e: Event) => {
    if (!ready()) return;
    e.preventDefault();
    quit();
  };

  window.addEventListener('mousemove', onMove, { capture: true, passive: true });
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  for (const type of ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart', 'contextmenu']) {
    window.addEventListener(type, onInput, { capture: true, passive: false });
  }
}
