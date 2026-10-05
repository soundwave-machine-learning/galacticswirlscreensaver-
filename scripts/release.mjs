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
// Publisher identity: tauri.conf.json carries the default
// ("Soundwave Machine Learning"). When the code-signing certificate is issued
// to a different legal name, set SFIELD_PUBLISHER (and optionally
// SFIELD_COPYRIGHT) so CompanyName, the installers' Publisher and the
// copyright match the certificate subject. Applied to the compile step too,
// because CompanyName is baked into the executable's version resource.
const identityOverlay = join(root, 'dist', 'tauri.identity.generated.json');
const identityArgs = [];
if (process.env.SFIELD_PUBLISHER || process.env.SFIELD_COPYRIGHT) {
  const publisher = process.env.SFIELD_PUBLISHER || conf.bundle.publisher;
  const copyright = process.env.SFIELD_COPYRIGHT || `Copyright (c) ${new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).getUTCFullYear()} ${publisher}. All rights reserved.`;
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(identityOverlay, JSON.stringify({ bundle: { publisher, copyright } }, null, 2));
  identityArgs.push('--config', identityOverlay);
  console.log(`Publisher identity override: ${publisher}`);
}
run('npx', ['tauri', 'build', '--no-bundle', ...identityArgs]);
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
if (SIGNED) {
  step('Verify signatures of SoundwavianField.exe and SoundwavianField.scr');
  for (const f of [exePath, join(stageDir, SCR)]) {
    const v = verifyFile(f);
    console.log(`${v.ok ? 'ok ' : 'BAD'} ${f}`);
    if (!v.ok) {
      console.error(v.output);
      throw new Error(`Signature verification failed for ${f} - a signed release never falls back to unsigned files.`);
    }
  }
}

// ---------------------------------------------------------------------------
step('Bundle installers (MSI + EXE)');
const overlays = [join(tauriDir, 'tauri.bundle.conf.json'), ...(identityArgs.length ? [identityOverlay] : [])];
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
// Release layout (what an ordinary user sees first):
//   SoundwavianField-Setup-<v>.exe   recommended installer
//   SoundwavianField-<v>.msi         for managed / enterprise deployment
//   SoundwavianField.exe / .scr      the program itself (portable copies)
//   SHA256SUMS.txt  BUILD_INFO.txt  README-FIRST.txt
//   reports/                         Defender output, build-info.json,
//                                    generated installer sources, test reports
step('Collect release artifacts');
rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const reportsDir = join(releaseDir, 'reports');
mkdirSync(join(reportsDir, 'installer-sources'), { recursive: true });
const SETUP_NAME = `SoundwavianField-Setup-${version}.exe`;
const MSI_NAME = `SoundwavianField-${version}.msi`;
const bundleDir = join(targetDir, 'bundle');
const found = [];
for (const sub of ['msi', 'nsis']) {
  const dir = join(bundleDir, sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (sub === 'msi' && f.endsWith('.msi')) found.push({ src: join(dir, f), name: MSI_NAME });
    if (sub === 'nsis' && f.endsWith('-setup.exe')) found.push({ src: join(dir, f), name: SETUP_NAME });
  }
}
if (found.length !== 2) throw new Error(`Expected an MSI and an EXE installer, found: ${found.map((f) => f.src).join(', ')}`);
for (const f of found) copyFileSync(f.src, join(releaseDir, f.name));
copyFileSync(exePath, join(releaseDir, EXE));
copyFileSync(join(stageDir, SCR), join(releaseDir, SCR));

// The generated installer sources, so reviewers can see exactly what each installer does.
for (const [src, name] of [
  [join(targetDir, 'wix', 'x64', 'main.wxs'), 'msi-main.wxs'],
  [join(targetDir, 'nsis', 'x64', 'installer.nsi'), 'nsis-installer.nsi'],
]) {
  if (existsSync(src)) copyFileSync(src, join(reportsDir, 'installer-sources', name));
}

// The distributable binaries, in a fixed order.
const artifacts = [SETUP_NAME, MSI_NAME, SCR, EXE];
for (const f of artifacts) if (!existsSync(join(releaseDir, f))) throw new Error(`${f} missing from release`);

// ---------------------------------------------------------------------------
const signatures = {};
if (SIGNED) {
  step('Verify Authenticode signatures of every distributable');
  for (const f of artifacts) {
    const v = verifyFile(join(releaseDir, f));
    signatures[f] = v.ok ? 'valid Authenticode signature' : 'INVALID';
    console.log(`${v.ok ? 'ok ' : 'BAD'} ${f}`);
    if (!v.ok) {
      console.error(v.output);
      throw new Error(`Signature verification failed for ${f} - a signed release never falls back to unsigned files.`);
    }
  }
} else {
  for (const f of artifacts) signatures[f] = 'unsigned (development build)';
}

// ---------------------------------------------------------------------------
step('Microsoft Defender scan (if available)');
const mpcmd = [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')].find((p) =>
  existsSync(p),
);
let defender = { available: Boolean(mpcmd), scanned: [], threatsFound: 0, incomplete: [], summary: '' };
if (mpcmd) {
  const lines = [];
  for (const f of artifacts) {
    const r = spawnSync(mpcmd, ['-Scan', '-ScanType', '3', '-File', join(releaseDir, f), '-DisableRemediation'], {
      encoding: 'utf8',
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    lines.push(`## ${f} (exit ${r.status})\n${out}\n`);
    defender.scanned.push(f);
    // MpCmdRun: 0 = no threats, 2 = threats found; anything else = the scan did not complete.
    if (r.status === 2) {
      const m = /found (\d+) threats?/i.exec(out);
      defender.threatsFound += m ? Number(m[1]) : 1;
    } else if (r.status !== 0 || !/found no threats/i.test(out)) {
      defender.incomplete.push(`${f} (exit ${r.status})`);
    }
  }
  writeFileSync(join(reportsDir, 'defender-scan.txt'), lines.join('\n'));
  defender.summary = defender.threatsFound
    ? `THREATS FOUND: ${defender.threatsFound}`
    : defender.incomplete.length
      ? `scan incomplete for: ${defender.incomplete.join(', ')}`
      : `no threats found in ${defender.scanned.length} files`;
} else {
  defender.summary = 'Defender not available on this machine - scan manually (docs/RELEASE.md)';
}
console.log(`Defender: ${defender.summary}`);
console.log(`  scanned: ${defender.scanned.join(', ') || 'none'}`);
console.log(`  threat count: ${defender.threatsFound}`);

// ---------------------------------------------------------------------------
// Hashes are computed LAST, from the final (signed, if --signed) files, so a
// signed release never carries the hashes of an unsigned build.
step('Checksums + build metadata');
const files = artifacts.map((f) => {
  const p = join(releaseDir, f);
  return { file: f, bytes: statSync(p).size, sha256: sha256(p), signature: signatures[f] };
});
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), files.map((f) => `${f.sha256}  ${f.file}`).join('\n') + '\n');

const tauriCrate = /name = "tauri"\r?\nversion = "([^"]+)"/.exec(readFileSync(join(tauriDir, 'Cargo.lock'), 'utf8'))?.[1];
const toolchain = {
  node: process.version,
  rustc: capture('rustc', ['--version']),
  cargo: capture('cargo', ['--version']),
  tauriCli: capture('npx', ['tauri', '--version']),
  tauriCrate: tauriCrate ?? null,
};
const ci = process.env.GITHUB_RUN_ID
  ? {
      workflow: process.env.GITHUB_WORKFLOW,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      url: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    }
  : null;
const builtAt = new Date().toISOString();
const publisherUsed = process.env.SFIELD_PUBLISHER || conf.bundle.publisher;
const info = {
  product: conf.productName,
  publisher: publisherUsed,
  identifier: conf.identifier,
  version,
  buildKind,
  signed: SIGNED,
  target: 'x86_64-pc-windows-msvc',
  webviewInstallMode: OFFLINE_WEBVIEW ? 'offlineInstaller' : conf.bundle.windows.webviewInstallMode.type,
  git: { commit, dirty },
  builtAt,
  sourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH),
  ci,
  toolchain,
  defender,
  files,
};
writeFileSync(join(reportsDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

const pad = (k) => `${k}:`.padEnd(22);
writeFileSync(
  join(releaseDir, 'BUILD_INFO.txt'),
  [
    `${pad('Product')}${conf.productName}`,
    `${pad('Version')}${version}`,
    `${pad('Build kind')}${buildKind}`,
    `${pad('Signed')}${SIGNED ? 'yes (Authenticode, verified with signtool)' : 'no'}`,
    `${pad('Publisher metadata')}${publisherUsed}`,
    `${pad('Git commit')}${commit ?? 'unknown'}${dirty ? ' (working tree had uncommitted changes)' : ''}`,
    `${pad('Build timestamp')}${builtAt}`,
    `${pad('Source date (commit)')}${new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()}`,
    `${pad('CI run')}${ci ? `${ci.workflow} #${ci.runId} attempt ${ci.runAttempt} - ${ci.url}` : 'local build'}`,
    `${pad('Target architecture')}x86_64-pc-windows-msvc (Windows 10/11 x64)`,
    `${pad('Rust')}${toolchain.rustc ?? 'unknown'}`,
    `${pad('Node')}${toolchain.node}`,
    `${pad('Tauri')}crate ${toolchain.tauriCrate ?? '?'}, ${toolchain.tauriCli ?? 'cli ?'}`,
    `${pad('WebView2 install mode')}${info.webviewInstallMode}`,
    `${pad('Defender')}${defender.summary}`,
    '',
    'Files (SHA-256 also in SHA256SUMS.txt):',
    ...files.map((f) => `  ${f.file.padEnd(36)} ${String(f.bytes).padStart(10)} bytes  ${f.sha256}  ${f.signature}`),
    '',
  ].join('\n'),
);

writeFileSync(join(releaseDir, 'README-FIRST.txt'), readmeFirst({ version, signed: SIGNED, setup: SETUP_NAME, msi: MSI_NAME }));

console.log(`\nRelease artifacts in ${releaseDir}:`);
for (const f of files) console.log(`  ${f.file.padEnd(36)} ${String(f.bytes).padStart(10)} bytes  ${f.sha256}  ${f.signature}`);
if (!SIGNED) {
  console.log('\nThis is a DEVELOPMENT build. Windows SmartScreen will warn on other PCs.');
  console.log('Do not distribute until the release gate in docs/RELEASE.md passes.');
}

// A Defender detection or an incomplete scan of a signed release fails the
// build; detections are never hidden or downgraded.
if (defender.threatsFound > 0) {
  console.error(`\nMicrosoft Defender reported ${defender.threatsFound} threat(s). Do NOT distribute. See reports/defender-scan.txt.`);
  process.exit(3);
}
if (SIGNED && (!defender.available || defender.incomplete.length)) {
  console.error('\nSigned release requires a completed Defender scan of every artifact on the release machine.');
  process.exit(4);
}

function readmeFirst({ version, signed, setup, msi }) {
  return `SOUNDWAVIAN FIELD ${version} - READ ME FIRST
==========================================

Soundwavian Field - Galactic Mandala Screensaver, by Soundwave Machine Learning.
Runs fully offline. It makes no network connections and installs no
background services, scheduled tasks or startup entries.

1. IS THIS BUILD SIGNED?
   ${signed ? 'Yes. Every program and installer here carries an Authenticode signature\n   from the publisher. Windows shows the publisher name when you install.' : 'NO. This is an unsigned development/test build. Windows will show\n   "Unknown publisher". Only install it if you received it directly from\n   the publisher for testing.'}

2. WINDOWS SMARTSCREEN
   Windows may show "Windows protected your PC" for new or unsigned
   software, even when it is safe. To continue: click "More info", then
   "Run anyway". Only do this if the SHA-256 check in step 3 matches.

3. VERIFY THE DOWNLOAD (SHA-256)
   In this folder, Shift + right-click > "Open in Terminal", then run:
       Get-FileHash .\\${setup} -Algorithm SHA256
   The long code must match the line for that file in SHA256SUMS.txt
   exactly. If it does not match, do not run the file.

4. WHICH INSTALLER?
   Most people: ${setup}   (recommended)
   IT departments / managed deployment: ${msi}
   Use one or the other, not both. Both install to
   C:\\Program Files\\Soundwavian Field\\ and need administrator approval once.
   SoundwavianField.exe / SoundwavianField.scr are the program itself, for
   inspection or portable use; you do not need them if you install.

5. USE IT AS YOUR SCREENSAVER
   a) Start "Soundwavian Field" from the Start menu.
   b) Move the mouse; a small panel appears at the bottom left.
   c) Click "Use as my screen saver", then "Screen Saver Settings..." to
      choose how many minutes Windows waits before starting it.
   (Alternative: right-click SoundwavianField.scr in
   C:\\Program Files\\Soundwavian Field\\ and choose "Install".)

6. SETTINGS
   Windows Screen Saver Settings > select Soundwavian Field > "Settings...".
   Or open the app and move the mouse to show the panel. Presets, sliders
   and quality are saved for your Windows account.

7. UNINSTALL
   Settings > Apps > Installed apps > Soundwavian Field > Uninstall.

8. MORE INFORMATION
   BUILD_INFO.txt   exact version, commit and build details
   SECURITY.md      what the program does and does not do on your PC
   docs/RELEASE.md and docs/PHYSICAL_WINDOWS_GATE.md
   (in the project's source repository) describe the release process.
`;
}
