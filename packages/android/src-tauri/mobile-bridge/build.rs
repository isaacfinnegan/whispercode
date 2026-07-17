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
    "get_push_state",
    "get_push_registration",
    "push_listeners_ready",
    "push_listeners_not_ready",
    "request_push_permission",
    "open_system_settings",
    "test_push",
    "begin_push_pairing",
    "get_push_pairing",
    "set_push_preferences",
    "set_push_relay_url",
    "set_push_credentials",
    "clear_push_pairing",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build()
        .unwrap();
}
