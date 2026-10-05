#!/usr/bin/env node
// Soundwavian Field - Windows release pipeline.
//
//   npm run release                 DEVELOPMENT build (unsigned)
//   npm run release -- --signed     SIGNED RELEASE build (requires a real
//                                   certificate, see scripts/sign.mjs)
//   options: --webview-offline      embed Microsoft's offline WebView2
//                                   installer (for machines without WebView2,
//                                   e.g. Windows 10 LTSC); much larger installer
//            --skip-tests           skip cargo test
//
// Pipeline: source -> production web build -> offline audit -> native build
//   -> (sign exe) -> stage .scr -> bundle MSI + EXE installers (signed when
//   --signed) -> verify signatures -> Defender scan (if available)
//   -> SHA-256 manifest + build metadata in dist/release/.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { signFile, signingConfigured, verifyFile } from './sign.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = new Set(process.argv.slice(2));
const SIGNED = args.has('--signed');
const OFFLINE_WEBVIEW = args.has('--webview-offline');
const isWindows = process.platform === 'win32';

const tauriDir = join(root, 'src-tauri');
const stageDir = join(root, 'dist', 'stage');
const releaseDir = join(root, 'dist', 'release');
const targetDir = join(tauriDir, 'target', 'release');
const EXE = 'SoundwavianField.exe';
const SCR = 'SoundwavianField.scr';

function step(title) {
  console.log(`\n=== ${title} ===`);
}

// npm/npx/cargo are .cmd/.exe shims on Windows and need a shell; quote any
// argument containing spaces so paths like "C:\Users\Jane Doe" survive.
const q = (a) => (isWindows && /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs.map(q), { stdio: 'inherit', shell: isWindows, cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`);
}

function capture(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs.map(q), { encoding: 'utf8', cwd: root, shell: isWindows, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------------------
step('Preflight');
if (!isWindows) {
  console.error('The Windows release must be built on Windows (or the windows-latest CI runner).');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'));
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(tauriDir, 'Cargo.toml'), 'utf8'))?.[1];
const version = pkg.version;
if (conf.version !== version || cargoVersion !== version) {
  throw new Error(`Version mismatch: package.json ${version}, tauri.conf.json ${conf.version}, Cargo.toml ${cargoVersion}`);
}
if (SIGNED && !signingConfigured()) {
  throw new Error('--signed requested but no certificate is configured (see scripts/sign.mjs).');
}
const commit = capture('git', ['rev-parse', 'HEAD']);
const dirty = Boolean(capture('git', ['status', '--porcelain']));
const commitTime = capture('git', ['log', '-1', '--format=%ct']);
// Reproducible metadata: timestamps derive from the commit, not the clock.
process.env.SOURCE_DATE_EPOCH = commitTime ?? String(Math.floor(Date.now() / 1000));
const buildKind = SIGNED ? 'SIGNED RELEASE' : 'DEVELOPMENT (unsigned)';
console.log(`Soundwavian Field ${version} - ${buildKind}${dirty ? ' - WARNING: working tree has uncommitted changes' : ''}`);

// ---------------------------------------------------------------------------
step('Web build + offline audit');
run('npm', ['run', 'build']);
run('node', ['scripts/audit-offline.mjs', '--native']);

if (!args.has('--skip-tests')) {
  step('Native unit tests');
  run('cargo', ['test', '--release', '--manifest-path', join(tauriDir, 'Cargo.toml')]);
}

// ---------------------------------------------------------------------------
step('Native build (no bundle)');
run('npx', ['tauri', 'build', '--no-bundle']);
const exePath = join(targetDir, EXE);
if (!existsSync(exePath)) throw new Error(`${exePath} was not produced`);

if (SIGNED) {
  step('Sign application executable');
  signFile(exePath);
}

step('Stage screen saver (.scr)');
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
// The .scr is the same executable; it inspects its own extension and the
// standard /s /c /p arguments. Copied after signing, so it carries the
// same Authenticode signature.
copyFileSync(exePath, join(stageDir, SCR));

// ---------------------------------------------------------------------------
step('Bundle installers (MSI + EXE)');
const overlays = [join(tauriDir, 'tauri.bundle.conf.json')];
const generated = join(stageDir, 'tauri.release.generated.json');
const overlay = { bundle: { windows: {} } };
if (SIGNED) {
  overlay.bundle.windows.signCommand = {
    cmd: 'node',
    args: [join(root, 'scripts', 'sign.mjs'), '%1'],
  };
}
if (OFFLINE_WEBVIEW) {
  overlay.bundle.windows.webviewInstallMode = { type: 'offlineInstaller', silent: true };
}
writeFileSync(generated, JSON.stringify(overlay, null, 2));
overlays.push(generated);
run('npx', ['tauri', 'bundle', '--bundles', 'msi,nsis', ...overlays.flatMap((c) => ['--config', c])]);

// ---------------------------------------------------------------------------
step('Collect release artifacts');
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const bundleDir = join(targetDir, 'bundle');
const found = [];
for (const sub of ['msi', 'nsis']) {
  const dir = join(bundleDir, sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (sub === 'msi' && f.endsWith('.msi')) found.push({ src: join(dir, f), name: `SoundwavianField-${version}-x64.msi` });
    if (sub === 'nsis' && f.endsWith('-setup.exe')) found.push({ src: join(dir, f), name: `SoundwavianField-${version}-x64-setup.exe` });
  }
}
if (found.length !== 2) throw new Error(`Expected an MSI and an EXE installer, found: ${found.map((f) => f.src).join(', ')}`);
for (const f of found) copyFileSync(f.src, join(releaseDir, f.name));
copyFileSync(exePath, join(releaseDir, EXE));
copyFileSync(join(stageDir, SCR), join(releaseDir, SCR));

// Keep the generated installer sources next to the artifacts so reviewers can
// see exactly what each installer does.
const inspection = join(releaseDir, 'inspection');
mkdirSync(inspection, { recursive: true });
for (const [src, name] of [
  [join(targetDir, 'wix', 'x64', 'main.wxs'), 'msi-main.wxs'],
  [join(targetDir, 'nsis', 'x64', 'installer.nsi'), 'nsis-installer.nsi'],
]) {
  if (existsSync(src)) copyFileSync(src, join(inspection, name));
}

const artifacts = readdirSync(releaseDir).filter((f) => statSync(join(releaseDir, f)).isFile()).sort();

// ---------------------------------------------------------------------------
const signatures = {};
if (SIGNED) {
  step('Verify Authenticode signatures');
  for (const f of artifacts) {
    const v = verifyFile(join(releaseDir, f));
    signatures[f] = v.ok ? 'valid' : 'INVALID';
    console.log(`${v.ok ? 'ok ' : 'BAD'} ${f}`);
    if (!v.ok) {
      console.error(v.output);
      throw new Error(`Signature verification failed for ${f}`);
    }
  }
} else {
  for (const f of artifacts) signatures[f] = 'unsigned (development build)';
}

// ---------------------------------------------------------------------------
step('Microsoft Defender scan (if available)');
const mpcmd = [
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe'),
].find((p) => existsSync(p));
let defender = 'not available on this machine - scan manually (see docs/RELEASE.md)';
if (mpcmd) {
  const lines = [];
  let threats = false;
  for (const f of artifacts) {
    const r = spawnSync(mpcmd, ['-Scan', '-ScanType', '3', '-File', join(releaseDir, f), '-DisableRemediation'], {
      encoding: 'utf8',
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    lines.push(`## ${f} (exit ${r.status})\n${out}\n`);
    // Exit code 2 = threats found. Other non-zero codes usually mean the
    // engine is disabled (e.g. CI images) and are reported, not hidden.
    if (r.status === 2) threats = true;
  }
  writeFileSync(join(releaseDir, 'defender-scan.txt'), lines.join('\n'));
  defender = threats ? 'THREATS REPORTED - see defender-scan.txt' : 'completed - see defender-scan.txt';
  if (threats) console.error('Defender reported a detection. Do NOT distribute; see defender-scan.txt.');
}
console.log(defender);

// ---------------------------------------------------------------------------
step('Checksums + build metadata');
const files = artifacts
  .filter((f) => !f.endsWith('.txt') && !f.endsWith('.json'))
  .map((f) => {
    const p = join(releaseDir, f);
    return { file: f, bytes: statSync(p).size, sha256: sha256(p), signature: signatures[f] };
  });
writeFileSync(
  join(releaseDir, 'SHA256SUMS.txt'),
  files.map((f) => `${f.sha256}  ${f.file}`).join('\n') + '\n',
);
const toolchain = {
  node: process.version,
  rustc: capture('rustc', ['--version']),
  cargo: capture('cargo', ['--version']),
  tauriCli: capture('npx', ['tauri', '--version']),
};
const info = {
  product: conf.productName,
  identifier: conf.identifier,
  version,
  buildKind,
  signed: SIGNED,
  webviewInstallMode: OFFLINE_WEBVIEW ? 'offlineInstaller' : conf.bundle.windows.webviewInstallMode.type,
  git: { commit, dirty },
  sourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH),
  builtFrom: new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString(),
  toolchain,
  defender,
  files,
};
writeFileSync(join(releaseDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(join(releaseDir, 'VERSION.txt'), `${conf.productName} ${version} (${buildKind})\n${commit ?? ''}\n`);

console.log(`\nRelease artifacts in ${releaseDir}:`);
for (const f of files) console.log(`  ${f.sha256}  ${f.file}  (${(f.bytes / 1e6).toFixed(1)} MB, ${f.signature})`);
if (!SIGNED) {
  console.log('\nThis is a DEVELOPMENT build. Windows SmartScreen will warn on other PCs.');
  console.log('Do not distribute until the release gate in docs/RELEASE.md passes.');
}
