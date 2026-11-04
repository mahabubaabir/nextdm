// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn is_native_messaging_invocation() -> bool {
    std::env::args().skip(1).any(|arg| {
        arg == "--native-messaging"
            || arg.starts_with("chrome-extension://")
            || arg == "nextdm@nextdm.app"
            || arg.ends_with("@nextdm.app")
            || arg.contains("com.nextdm.host")
            || (arg.ends_with(".json")
                && (arg.contains("nextdm") || arg.contains("NativeMessaging") || arg.contains("Mozilla")))
    })
}

fn is_register_invocation() -> bool {
    std::env::args().skip(1).any(|arg| {
        arg == "--register-native-host"
            || arg == "--install-integration"
            || arg == "/register"
    })
}

fn main() {
    // 1. When started by a browser (Firefox, Chrome, Edge, Brave, etc.),
    // run in native messaging mode immediately without initializing Tauri or GUI.
    if is_native_messaging_invocation() {
        nextdm_desktop_lib::run_native_host();
    }

    // 2. Command-line registration helper (used by installer / batch script)
    if is_register_invocation() {
        let _ = nextdm_desktop_lib::install_integration_headless();
        std::process::exit(0);
    }

    // 3. Normal desktop application launch
    nextdm_desktop_lib::run()
}
