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
| `build-info.json` → `buildKind` | `DEVELOPMENT (unsigned)` | `SIGNED RELEASE` |
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

What happens during `--signed`:

1. `SoundwavianField.exe` is signed right after compiling.
2. That signed file is copied to `SoundwavianField.scr`, so it carries the same signature.
3. Tauri's bundler gets `bundle.windows.signCommand = node scripts/sign.mjs %1`
   through a generated config overlay. It then signs the binaries it packages,
   the NSIS uninstaller, and both installers. `src-tauri/tauri.conf.json`
   itself never contains signing secrets.
4. Every artifact in `dist/release/` is verified with `signtool verify /pa /all`.

### In CI

`.github/workflows/windows-release.yml` signs only when run manually with
`signed: true`. It expects these repository secrets and variables:

- secret `SFIELD_SIGN_PFX_BASE64`: base64 of the `.pfx`
- secret `SFIELD_SIGN_PFX_PASSWORD`
- variable `SFIELD_TIMESTAMP_URL` (optional)

The `.pfx` is written to the runner's temp directory and deleted afterwards.
If you use a hardware token or a cloud HSM (now the norm for new
certificates), sign on a dedicated release machine, or switch the CI step to
`SFIELD_SIGN_COMMAND` with your provider's tooling.

## Which certificate?

- An **OV (Organisation Validation)** or **individual validation** code-signing
  certificate from a public CA is enough. Since 2023 these are issued on
  hardware tokens or cloud HSMs.
- **Azure Trusted Signing** is a low-cost managed option for individuals and
  small organisations in supported regions.
- An **EV** certificate no longer gives instant SmartScreen reputation (that
  changed in 2024), so it isn't required.

Use the **same certificate and publisher name for every release**. SmartScreen
reputation builds up on the signer, and switching certificates resets it. Make
the publisher name in `src-tauri/tauri.conf.json` (`bundle.publisher`,
`bundle.copyright`) match the certificate's subject before the first signed
release.

## Verifying a signed file yourself

```powershell
Get-AuthenticodeSignature .\SoundwavianField-0.1.0-x64.msi | Format-List
signtool verify /pa /all /v .\SoundwavianField.scr
```
