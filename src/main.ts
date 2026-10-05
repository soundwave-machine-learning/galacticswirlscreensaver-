import './style.css';
import { Scene } from './renderer/Scene';
import { TextureField } from './systems/TextureField';

async function boot() {
  const canvas = document.getElementById('field') as HTMLCanvasElement;
  const scene = new Scene(canvas);
  const textures = new TextureField();
  const [first] = await textures.load(scene.renderer);
  scene.setField(first);
  window.addEventListener('resize', () => scene.resize());

  // Deterministic offline stepping for previews/tests: ?capture
  if (new URLSearchParams(location.search).has('capture')) {
    const w = window as unknown as Record<string, unknown>;
    w.__advance = (seconds: number, step = 1 / 30) => {
      for (let t = 0; t < seconds; t += step) scene.update(step);
      scene.render();
    };
    w.__ready = true;
    scene.render();
    return;
  }

  let last = performance.now();
  const stats = { frames: 0, worst: 0, sum: 0 };
  (window as unknown as { __stats: typeof stats }).__stats = stats;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    stats.frames++;
    stats.sum += dt;
    stats.worst = Math.max(stats.worst, dt);
    scene.update(dt);
    scene.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
