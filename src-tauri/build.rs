fn main() {
    // String resource 1 (IDS_DESCRIPTION) is the name the Windows Screen
    // Saver Settings dialog shows for a .scr; without it Windows falls back
    // to the file name ("SoundwavianField").
    let windows = tauri_build::WindowsAttributes::new()
        .append_rc_content("STRINGTABLE\nBEGIN\n  1 \"Soundwavian Field\"\nEND\n");
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
