#!/usr/bin/env node
// Renders documentation stills and a short preview clip deterministically,
// using the app's `?capture` mode (fixed time steps, no real-time clock).
//
//   npm run build && npx vite preview --port 4173 &   # serve dist/web
//   npm run capture -- --url http://localhost:4173/
//
// Needs Playwright (`npm i -D playwright` or a global install) and, for the
// clip, ffmpeg on PATH. Output: docs/screenshots/ and docs/preview.mp4.
// Frames are software-rendered (SwiftShader): slow, but visually the same output.

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const base = arg('url', 'http://localhost:4173/');
const seed = arg('seed', '20261005');
const width = Number(arg('width', '1600'));
const height = Number(arg('height', '900'));
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const shots = join(root, 'docs', 'screenshots');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run `npm i -D playwright` (no browser download needed if one is configured).');
  process.exit(1);
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(query, w = width, h = height) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${base}?capture&seed=${seed}&${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return page;
}

const advance = (page, seconds, step = 1 / 15) =>
  page.evaluate(([s, st]) => window.__advance(s, st), [seconds, step]);

mkdirSync(shots, { recursive: true });

// One still per preset, settled for 40 simulated seconds.
for (const preset of ['stillness', 'orbit', 'deep-field', 'ascension', 'void']) {
  const page = await open(`preset=${preset}&quality=high`);
  await advance(page, 40);
  await page.screenshot({ path: join(shots, `preset-${preset}.jpg`), quality: 88, type: 'jpeg' });
  console.log(`preset ${preset}`);
  await page.close();
}

// A transition, caught at its midpoint (hurried with "Next Field").
{
  const page = await open('preset=orbit&quality=high');
  await advance(page, 10);
  await page.evaluate(() => window.__scene.nextField());
  await advance(page, 6);
  await page.screenshot({ path: join(shots, 'transition.jpg'), quality: 88, type: 'jpeg' });
  console.log('transition');
  await page.close();
}

// The matrix layer on its own (painting hidden) to show the hidden geometry.
{
  const page = await open('preset=orbit&quality=high');
  await page.evaluate(() => {
    const s = window.__scene;
    Object.assign(s.target, { matrixOpacity: 0.4, matrixReveal: 0, glyphs: 1 });
    s.params.matrixOpacity = 0.4;
    s.scene.children[0].visible = false;
  });
  await advance(page, 20);
  await page.screenshot({ path: join(shots, 'matrix-layer.jpg'), quality: 90, type: 'jpeg' });
  console.log('matrix layer');
  await page.close();
}

// Preview clip: 12 s at 30 fps of Orbit, real-time pacing.
if (!process.argv.includes('--no-video')) {
  const frames = join(root, 'dist', 'capture-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const page = await open('preset=orbit&quality=high', 1280, 720);
  await advance(page, 30);
  const fps = 30;
  for (let i = 0; i < fps * 12; i++) {
    await advance(page, 1 / fps, 1 / fps);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
    if (i % 30 === 0) console.log(`frame ${i}`);
  }
  await page.close();
  const out = join(root, 'docs', 'preview.mp4');
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', out],
    { stdio: 'inherit' },
  );
  if (r.status === 0 && existsSync(out)) console.log(`wrote ${out}`);
  rmSync(frames, { recursive: true, force: true });
}

await browser.close();
