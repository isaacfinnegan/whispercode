use tauri::{command, AppHandle, Runtime};

use crate::{MobileBridgeExt, Result};

#[command]
pub(crate) async fn is_whisper_ready<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().is_whisper_ready()
}

#[command]
pub(crate) async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().start_recording()
}

#[command]
pub(crate) async fn stop_recording<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().stop_recording()
}

#[command]
pub(crate) async fn scan_network<R: Runtime>(app: AppHandle<R>) -> Result<Vec<crate::ScanResult>> {
    app.mobile_bridge().scan_network()
}

#[command]
pub(crate) async fn cancel_scan<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().cancel_scan()
}

#[command]
pub(crate) async fn share<R: Runtime>(
    app: AppHandle<R>,
    text: Option<String>,
    url: Option<String>,
) -> Result<bool> {
    app.mobile_bridge().share(text, url)
}

#[command]
pub(crate) async fn get_push_state<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().get_push_state()
}

#[cfg(target_os = "android")]
#[command]
pub(crate) async fn get_push_registration<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().get_push_registration()
}

#[cfg(target_os = "android")]
#[command]
pub(crate) async fn push_listeners_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().push_listeners_ready()
}

#[cfg(target_os = "android")]
#[command]
pub(crate) async fn push_listeners_not_ready<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().push_listeners_not_ready()
}

#[command]
pub(crate) async fn request_push_permission<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().request_push_permission()
}

#[command]
pub(crate) async fn open_system_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.mobile_bridge().open_system_settings()
}

#[command]
pub(crate) async fn test_push<R: Runtime>(app: AppHandle<R>, href: Option<String>) -> Result<serde_json::Value> {
    app.mobile_bridge().test_push(href)
}

#[command]
pub(crate) async fn begin_push_pairing<R: Runtime>(app: AppHandle<R>, version: Option<String>) -> Result<serde_json::Value> {
    app.mobile_bridge().begin_push_pairing(version)
}

#[command]
pub(crate) async fn get_push_pairing<R: Runtime>(app: AppHandle<R>, pair_id: Option<String>) -> Result<serde_json::Value> {
    app.mobile_bridge().get_push_pairing(pair_id)
}

#[command]
pub(crate) async fn set_push_preferences<R: Runtime>(app: AppHandle<R>, payload: serde_json::Value) -> Result<()> {
    app.mobile_bridge().set_push_preferences(payload)
}

#[command]
pub(crate) async fn set_push_relay_url<R: Runtime>(app: AppHandle<R>, url: Option<String>) -> Result<()> {
    app.mobile_bridge().set_push_relay_url(url)
}

#[command]
pub(crate) async fn set_push_credentials<R: Runtime>(
    app: AppHandle<R>,
    channel: String,
    device: String,
    secret: String,
) -> Result<serde_json::Value> {
    app.mobile_bridge().set_push_credentials(channel, device, secret)
}

#[command]
pub(crate) async fn clear_push_pairing<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> {
    app.mobile_bridge().clear_push_pairing()
}
