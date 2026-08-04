const COMMANDS: &[&str] = &[
    "check_permissions",
    "request_permissions",
    "register_listener",
    "remove_listener",
    "is_whisper_ready",
    "start_recording",
    "stop_recording",
    "scan_network",
    "cancel_scan",
    "share",
    "deep_link_listeners_ready",
    "deep_link_listeners_not_ready",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .unwrap();
}
