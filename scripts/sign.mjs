#!/usr/bin/env node
// Authenticode signing wrapper (Windows, signtool.exe).
//
//   node scripts/sign.mjs <file> [<file>...]
//
// Configure ONE of these in the environment of the release machine. Nothing
// here creates, embeds or fakes a certificate; without configuration this
// script refuses to run and the build stays an unsigned DEVELOPMENT build.
//
//   SFIELD_SIGN_THUMBPRINT   SHA-1 thumbprint of a code-signing certificate in
//                            the Windows certificate store (e.g. on a USB/HSM
//                            token, which is how most OV/EV certificates ship).
//   SFIELD_SIGN_PFX          path to a .pfx file, with
//   SFIELD_SIGN_PFX_PASSWORD its password (prefer a CI secret, never commit).
//   SFIELD_SIGN_COMMAND      full custom command for cloud signing services
//                            (Azure Trusted Signing, SSL.com eSigner, ...);
//                            "{file}" is replaced with the file path.
//
// Optional:
//   SFIELD_TIMESTAMP_URL     RFC 3161 timestamp server from your CA
//                            (default: http://timestamp.digicert.com)
//   SIGNTOOL                 explicit path to signtool.exe

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DESCRIPTION = 'Soundwavian Field';

export function signingConfigured() {
  const e = process.env;
  return Boolean(e.SFIELD_SIGN_THUMBPRINT || e.SFIELD_SIGN_PFX || e.SFIELD_SIGN_COMMAND);
}

export function findSigntool() {
  if (process.env.SIGNTOOL && existsSync(process.env.SIGNTOOL)) return process.env.SIGNTOOL;
  const kits = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (existsSync(kits)) {
    const versions = readdirSync(kits)
      .filter((d) => /^10\./.test(d))
      .sort()
      .reverse();
    for (const v of versions) {
      const p = join(kits, v, 'x64', 'signtool.exe');
      if (existsSync(p)) return p;
    }
  }
  return 'signtool.exe'; // rely on PATH (Developer Command Prompt)
}

export function signFile(file) {
  const e = process.env;
  if (e.SFIELD_SIGN_COMMAND) {
    const cmd = e.SFIELD_SIGN_COMMAND.replaceAll('{file}', `"${file}"`);
    const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`custom sign command failed for ${file}`);
    return;
  }
  const ts = e.SFIELD_TIMESTAMP_URL || 'http://timestamp.digicert.com';
  const args = ['sign', '/fd', 'sha256', '/td', 'sha256', '/tr', ts, '/d', DESCRIPTION];
  if (e.SFIELD_SIGN_THUMBPRINT) args.push('/sha1', e.SFIELD_SIGN_THUMBPRINT);
  else if (e.SFIELD_SIGN_PFX) {
    args.push('/f', e.SFIELD_SIGN_PFX);
    if (e.SFIELD_SIGN_PFX_PASSWORD) args.push('/p', e.SFIELD_SIGN_PFX_PASSWORD);
  } else {
    throw new Error('No signing certificate configured (see scripts/sign.mjs).');
  }
  args.push(file);
  execFileSync(findSigntool(), args, { stdio: 'inherit' });
}

export function verifyFile(file) {
  const r = spawnSync(findSigntool(), ['verify', '/pa', '/all', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// CLI (also used as Tauri's signCommand while bundling).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/sign.mjs <file> [...]');
    process.exit(2);
  }
  if (!signingConfigured()) {
    console.error('Refusing to sign: no certificate configured. See the header of scripts/sign.mjs.');
    process.exit(1);
  }
  for (const f of files) {
    console.log(`signing ${f}`);
    signFile(f);
  }
}
