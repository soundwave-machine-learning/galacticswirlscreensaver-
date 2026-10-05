# Code signing (Authenticode)

The repository builds and runs **unsigned** for development. A distributable
release must be signed with a **real** code-signing certificate issued to the
publisher. This project never generates, embeds, or fakes a certificate.

## DEVELOPMENT build vs SIGNED RELEASE build

| | DEVELOPMENT | SIGNED RELEASE |
| --- | --- | --- |
| Command | `npm run release` | `npm run release:signed` |
| Certificate | none | required (refuses to run without one) |
| Signed files | none | `SoundwavianField.exe`, `SoundwavianField.scr`, the MSI, the setup `.exe` and its embedded uninstaller |
| Signature verification | n/a | `signtool verify /pa /all` on every artifact; the build fails on any invalid signature |
| `BUILD_INFO.txt` → Build kind | `DEVELOPMENT (unsigned)` | `SIGNED RELEASE` |
| Suitable for other people | no (SmartScreen will warn) | yes, after the release gate in [RELEASE.md](RELEASE.md) |

## Where the certificate is configured

All signing goes through **`scripts/sign.mjs`**, a thin wrapper around
Microsoft's `signtool.exe` (from the Windows SDK). Set exactly **one** of the
following as environment variables on the release machine or as CI secrets.
Never commit them.

| Variable | Use when |
| --- | --- |
| `SFIELD_SIGN_THUMBPRINT` | The certificate is in the Windows certificate store, e.g. on a USB token or HSM, which is how most OV/EV certificates are delivered now. Value: the SHA-1 thumbprint. |
| `SFIELD_SIGN_PFX` + `SFIELD_SIGN_PFX_PASSWORD` | You have a `.pfx` file (legacy delivery, or a CI-held certificate). |
| `SFIELD_SIGN_COMMAND` | A cloud signing service (e.g. **Azure Trusted Signing**, SSL.com eSigner, DigiCert KeyLocker). Give the full command; `{file}` is replaced with the path. Example: `signtool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\tools\Azure.CodeSigning.Dlib.dll" /dmdf "C:\tools\metadata.json" {file}` |

Optional:

- `SFIELD_TIMESTAMP_URL`: your CA's RFC 3161 timestamp server (default
  `http://timestamp.digicert.com`). Timestamping keeps signatures valid after
  the certificate expires. It's contacted **at build time only**.
- `SIGNTOOL`: explicit path to `signtool.exe` if it isn't found automatically.

### The signed release sequence (as implemented in `scripts/release.mjs --signed`)

| # | Step | Where | On failure |
| --- | --- | --- | --- |
| 1 | Clean checkout of the release commit (CI: `actions/checkout`; locally: `git status` must be clean, and `build-info` records a dirty tree) | CI / you | — |
| 2 | Web build + offline audit + native unit tests, then `tauri build --no-bundle` → `SoundwavianField.exe` | release.mjs | job fails |
| 3 | **Sign** `SoundwavianField.exe` | `sign.mjs` → `signtool sign /fd sha256 /td sha256 /tr <timestamp>` | job fails |
| 4 | **Stage** `SoundwavianField.scr` as a copy of the signed exe (so it carries the same signature) | release.mjs | job fails |
| 5 | **Verify** both with `signtool verify /pa /all` | release.mjs | job fails, *no unsigned fallback* |
| 6 | **Build installers** from those binaries. Tauri stamps an installer-type marker into the exe it packages (observed in every CI build), which invalidates that copy's signature, so its bundler signs the binaries it packages through the same `signCommand`. The `.scr` is packaged as the already-signed file. *Not yet exercised with a real certificate:* if any packaged file ended up unsigned, steps 9 and 12 would fail the job | `tauri bundle` with `signCommand = node scripts/sign.mjs %1` | job fails |
| 7–8 | **Sign** the NSIS uninstaller, the **MSI** and the **setup.exe** | Tauri via `signCommand` | job fails |
| 9 | **Verify** the setup.exe, the MSI, the `.scr` and the `.exe` in `dist/release/` | release.mjs | job fails |
| 10 | **Microsoft Defender** scan of every artifact | release.mjs (`MpCmdRun -Scan -ScanType 3`) | any detection fails the job (exit 3). A signed build also fails if the scan can't complete (exit 4) |
| 11 | **SHA-256** of the final, signed files → `SHA256SUMS.txt`, `BUILD_INFO.txt` | release.mjs, as its last step | — |
| 12 | Static inspection plus install/run/uninstall tests of both installers. For a signed run these also assert a valid signature on every installed PE file and on the installer | CI: `inspect-release.ps1`, `smoke-test.ps1` | job fails |
| 13 | Upload `dist/release/` as a **private** CI artifact | CI | — |

**Tested failure paths (every CI run):** `release.mjs --signed` with no certificate configured exits non-zero before
building anything, and `sign.mjs` refuses to run without a certificate. The successful signed path runs for the first
time when a real certificate is configured.

**Hashes come after signing.** Signing rewrites the files, so the hashes are computed last (step 11), from the
exact bytes being shipped. A signed release can never carry the hashes of an unsigned build. The tests in step 12
only read the artifacts, so the hashes stay valid. A signed job that hits any signing or verification error stops;
it never falls back to unsigned output.

`src-tauri/tauri.conf.json` never contains signing configuration. `signCommand` is injected through a generated
overlay only when `--signed` is used.

### In CI (GitHub Actions)

`.github/workflows/windows-release.yml` signs only when started manually (**Actions → Windows build → Run workflow**)
with `signed: true`. On normal pushes it builds unsigned.

Required **secrets** (Settings → Secrets and variables → Actions; names only, never commit values):

| Name | Content |
| --- | --- |
| `SFIELD_SIGN_PFX_BASE64` | the `.pfx` file, base64-encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes('cert.pfx'))`) |
| `SFIELD_SIGN_PFX_PASSWORD` | its password |

Optional **variables**: `SFIELD_TIMESTAMP_URL` (your CA's RFC 3161 server), `SFIELD_PUBLISHER`,
`SFIELD_COPYRIGHT` (see below).

How the certificate is handled in a signed run:

1. **Prepare signing certificate.** The secret is decoded to `%RUNNER_TEMP%\codesign.pfx`. The step fails if the
   secret is missing, so `signed: true` without a certificate can't produce an unsigned "signed" build. Nothing is
   imported into a certificate store; `signtool /f` reads the file directly.
2. **Build release artifacts.** `scripts/release.mjs --signed` signs and verifies as in the table above. GitHub
   masks secret values in logs, and the script never prints the signtool arguments.
3. **Remove signing certificate** runs right after the build, even when the build fails (`if: always()`), deletes
   the file, and fails if it still exists.
4. Tests and the private artifact upload follow. The certificate is already gone at that point.

Verification command used everywhere: `signtool verify /pa /all <file>` (and `Get-AuthenticodeSignature` in the
tests).

Hardware tokens and cloud HSMs (the norm for certificates issued since 2023) can't be exported as a `.pfx`. Sign on a
dedicated release machine with `SFIELD_SIGN_THUMBPRINT`, or set `SFIELD_SIGN_COMMAND` to your provider's signing
tool (Azure Trusted Signing, SSL.com eSigner, DigiCert KeyLocker…). The rest of the sequence is identical.

### Never commit

`.pfx`, `.p12`, `.pvk`, `.spc`, `.key`, `.pem`, `.cer` files, passwords, or base64 certificate blobs.
`.gitignore` blocks these file types. Signing inputs come only from protected CI secrets or from environment
variables on the release machine.

## Which certificate?

- An **OV (Organisation Validation)** or **individual validation** code-signing
  certificate from a public CA is enough. Since 2023 these are issued on
  hardware tokens or cloud HSMs.
- **Azure Trusted Signing** is a low-cost managed option for individuals and
  small organisations in supported regions.
- An **EV** certificate no longer gives instant SmartScreen reputation (that
  changed in 2024), so it isn't required.

Use the **same certificate and publisher name for every release**. SmartScreen
reputation builds up on the signer, and switching certificates resets it.

### Publisher name vs. certificate subject

The default identity in `src-tauri/tauri.conf.json` is **Soundwave Machine
Learning**. It appears as CompanyName in the executable's version info, as
the installers' Publisher, in Add/Remove Programs and in the copyright line.
The certificate's subject (the "Verified publisher" Windows shows) comes from
the certificate itself and can't be set here. If the certificate is issued to
a different legal name (e.g. "Soundwave Machine Learning LLC"), make the
metadata match it without editing source:

| Variable | Effect |
| --- | --- |
| `SFIELD_PUBLISHER` | Overrides `bundle.publisher` for both the compile and bundle steps (CompanyName, installer Publisher) |
| `SFIELD_COPYRIGHT` | Overrides the copyright line (default: `Copyright (c) <commit year> <publisher>. All rights reserved.`) |

In CI, set them as repository **variables** of the same names.
`build-info.json` records the publisher each build used.

## Verifying a signed file yourself

```powershell
Get-AuthenticodeSignature .\SoundwavianField-Setup-0.1.0.exe | Format-List
signtool verify /pa /all /v .\SoundwavianField.scr
```
