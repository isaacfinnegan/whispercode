use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{error::Error, models::ScanResult};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<MobileBridge<R>> {
    Ok(MobileBridge(std::marker::PhantomData))
}

pub struct MobileBridge<R: Runtime>(pub std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> MobileBridge<R> {
    pub fn is_whisper_ready(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn start_recording(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn stop_recording(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn scan_network(&self) -> crate::Result<Vec<ScanResult>> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn cancel_scan(&self) -> crate::Result<()> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn share(&self, _text: Option<String>, _url: Option<String>) -> crate::Result<bool> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn get_push_state(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn request_push_permission(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn open_system_settings(&self) -> crate::Result<()> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn test_push(&self, _href: Option<String>) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn begin_push_pairing(&self, _version: Option<String>) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn get_push_pairing(&self, _pair_id: Option<String>) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn set_push_preferences(&self, _payload: serde_json::Value) -> crate::Result<()> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn set_push_relay_url(&self, _url: Option<String>) -> crate::Result<()> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn set_push_credentials(&self, _channel: String, _device: String, _secret: String) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }

    pub fn clear_push_pairing(&self) -> crate::Result<serde_json::Value> {
        Err(Error::Message(
            "Mobile bridge is unavailable on this platform".to_string(),
        ))
    }
}
