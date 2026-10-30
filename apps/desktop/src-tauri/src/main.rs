// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The browser starts this binary in native-messaging mode. It must not
    // initialize Tauri or open a window.
    if std::env::args().skip(1).any(|arg| arg == "--native-messaging") {
        nextdm_desktop_lib::run_native_host();
    }
    nextdm_desktop_lib::run()
}
