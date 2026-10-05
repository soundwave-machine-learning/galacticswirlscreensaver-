; Soundwavian Field - NSIS installer hooks (used by the .exe installer).
; The MSI does the equivalent through Windows Installer's own tables.
;
; Install: nothing beyond Tauri's standard per-machine install (files under
;          Program Files, Start Menu shortcut, Add/Remove Programs entry).
; Uninstall: if the *current user's* screen saver still points at our .scr,
;          clear that one value so Windows does not try to start a file that
;          no longer exists. No other registry value is touched.

!macro NSIS_HOOK_PREINSTALL
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend

; Runs while the .scr still exists, so its short (8.3) path can be resolved.
!macro NSIS_HOOK_PREUNINSTALL
  ReadRegStr $0 HKCU "Control Panel\Desktop" "SCRNSAVE.EXE"
  StrCmp $0 "" sf_done
  ; Compare against both the long and the short (8.3) install path.
  GetFullPathName $1 "$INSTDIR\SoundwavianField.scr"
  GetFullPathName /SHORT $2 "$INSTDIR\SoundwavianField.scr"
  StrCmp $0 $1 sf_clear
  StrCmp $0 $2 sf_clear
  Goto sf_done
  sf_clear:
    DeleteRegValue HKCU "Control Panel\Desktop" "SCRNSAVE.EXE"
  sf_done:
!macroend
