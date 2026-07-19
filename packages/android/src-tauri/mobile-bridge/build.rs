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

const ANDROID_COMMANDS: &[&str] = &["get_push_registration"];

fn main() {
    let mut commands = COMMANDS.to_vec();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        commands.extend_from_slice(ANDROID_COMMANDS);
    }
    tauri_plugin::Builder::new(&commands)
        .android_path("android")
        .try_build()
        .unwrap();
}
