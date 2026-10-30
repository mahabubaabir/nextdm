//! Standalone NextDM Native Messaging Host binary.
//!
//! Started by Chromium/Firefox via native messaging manifests.
//! Communicates with the NextDM desktop application over a local Unix domain socket.

fn main() {
    std::process::exit(nextdm_browser_host::run_native_host());
}

