#!/usr/bin/env node
// Offline / transparency audit. Fails (exit 1) if the shipped web bundle or
// the native build could reach the network, load remote code, or contain
// development artefacts. Runs after every `npm run build` and in release.
//
//   node scripts/audit-offline.mjs            web bundle checks
//   node scripts/audit-offline.mjs --native   also inspect the Rust dependency graph

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = join(root, 'dist', 'web');
const problems = [];
const notes = [];

// Strings that look like URLs but are inert identifiers, never requested.
const INERT_URLS = [
  /^http:\/\/www\.w3\.org\//, // XML/SVG/XHTML namespace identifiers
  /^https:\/\/jcgt\.org\/published\//, // citation inside a three.js shader comment
  // Tauri's IPC endpoint: a custom scheme served in-process by the app
  // through WebView2's resource handler. It never reaches a network stack.
  /^http:\/\/ipc\.localhost;?$/,
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

if (!existsSync(dist)) {
  console.error('dist/web does not exist - run `npm run build` first.');
  process.exit(1);
}

const files = walk(dist);
for (const file of files) {
  const rel = relative(root, file);
  const ext = extname(file).toLowerCase();
  if (ext === '.map') problems.push(`${rel}: source map in production bundle`);
  if (!['.js', '.html', '.css', '.json', '.txt', '.svg'].includes(ext)) continue;
  const text = readFileSync(file, 'utf8');

  for (const m of text.matchAll(/\b(?:https?|wss?|ftp):\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0];
    if (INERT_URLS.some((re) => re.test(url))) {
      notes.push(`${rel}: inert reference ${url}`);
    } else {
      problems.push(`${rel}: remote URL ${url}`);
    }
  }
  // Protocol-relative script/style/font references.
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']\/\/[^"']+/g)) problems.push(`${rel}: protocol-relative ${m[0]}`);
  if (/navigator\.sendBeacon\s*\(/.test(text)) problems.push(`${rel}: navigator.sendBeacon (telemetry API)`);
  if (/\bimportScripts\s*\(/.test(text)) problems.push(`${rel}: importScripts`);
  if (/new\s+WebSocket\s*\(/.test(text)) problems.push(`${rel}: WebSocket`);
  if (/\beval\s*\(\s*atob/.test(text)) problems.push(`${rel}: encoded eval`);
  if (ext === '.html' && /<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(text)) problems.push(`${rel}: inline <script> in HTML`);
}

// Required local assets.
for (const name of ['Galactic_Swirl_1.png', 'Galactic_Swirl_2.png', 'Galactic_Swirl_3.png']) {
  if (!existsSync(join(dist, 'fields', name))) problems.push(`dist/web/fields/${name} missing`);
}

// Native side: no networking crates, no updater/http plugins compiled in.
if (process.argv.includes('--native')) {
  const FORBIDDEN = /^(reqwest|hyper|ureq|curl|isahc|attohttpc|native-tls|rustls|tungstenite|tokio-tungstenite|tauri-plugin-(updater|http|websocket|upload|deep-link|shell))$/;
  try {
    const out = execFileSync(
      'cargo',
      ['tree', '--target', 'x86_64-pc-windows-msvc', '-e', 'normal', '--prefix', 'none', '--manifest-path', join(root, 'src-tauri', 'Cargo.toml')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const crates = new Set(out.split(/\r?\n/).map((l) => l.trim().split(' ')[0]).filter(Boolean));
    for (const c of crates) if (FORBIDDEN.test(c)) problems.push(`native dependency graph contains ${c}`);
    notes.push(`native: ${crates.size} crates in the Windows build graph, none network-capable`);
  } catch (e) {
    problems.push(`could not inspect the Rust dependency graph: ${e.message}`);
  }
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  if (conf.plugins && Object.keys(conf.plugins).length) problems.push('tauri.conf.json declares plugins');
  const csp = JSON.stringify(conf.app?.security?.csp ?? '').replace(/http:\/\/ipc\.localhost/g, '');
  if (/https?:\/\/|wss?:\/\//.test(csp)) problems.push('CSP allows a remote origin');
  if (conf.bundle?.createUpdaterArtifacts) problems.push('updater artifacts enabled');
  if (conf.bundle?.windows?.webviewInstallMode?.type?.toLowerCase().includes('download')) {
    problems.push('installer would download the WebView2 runtime');
  }
}

for (const n of notes) console.log(`  note  ${n}`);
if (problems.length) {
  console.error(`\nOffline audit FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  x  ${p}`);
  process.exit(1);
}
console.log(`Offline audit passed: ${files.length} files, no remote URLs, no telemetry APIs.`);
