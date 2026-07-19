use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::ScanResult;

const PLUGIN_IDENTIFIER: &str = "ai.opencode.mobilebridge";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobileBridge<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileBridgePlugin")?;
    Ok(MobileBridge(handle))
}

pub struct MobileBridge<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MobileBridge<R> {
    pub fn is_whisper_ready(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("isWhisperReady", ())
            .map_err(Into::into)
    }

    pub fn start_recording(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("startRecording", ())
            .map_err(Into::into)
    }

    pub fn stop_recording(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("stopRecording", ())
            .map_err(Into::into)
    }

    pub fn scan_network(&self) -> crate::Result<Vec<ScanResult>> {
        self.0
            .run_mobile_plugin("scanNetwork", ())
            .map_err(Into::into)
    }

    pub fn cancel_scan(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("cancelScan", ())
            .map_err(Into::into)
    }

    pub fn share(&self, text: Option<String>, url: Option<String>) -> crate::Result<bool> {
        self.0
            .run_mobile_plugin("share", SharePayload { text, url })
            .map_err(Into::into)
    }

    pub fn get_push_state(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("getPushState", ())
            .map_err(Into::into)
    }

    #[cfg(target_os = "android")]
    pub fn get_push_registration(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("getPushRegistration", ())
            .map_err(Into::into)
    }

    #[cfg(target_os = "android")]
    pub fn push_listeners_ready(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("pushListenersReady", ())
            .map_err(Into::into)
    }

    #[cfg(target_os = "android")]
    pub fn push_listeners_not_ready(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("pushListenersNotReady", ())
            .map_err(Into::into)
    }

    pub fn request_push_permission(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("requestPushPermission", ())
            .map_err(Into::into)
    }

    pub fn open_system_settings(&self) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("openSystemSettings", ())
            .map_err(Into::into)
    }

    pub fn test_push(&self, href: Option<String>) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("testPush", TestPushPayload { href })
            .map_err(Into::into)
    }

    pub fn begin_push_pairing(&self, version: Option<String>) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("beginPushPairing", BeginPushPairingPayload { version })
            .map_err(Into::into)
    }

    pub fn get_push_pairing(&self, pair_id: Option<String>) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("getPushPairing", GetPushPairingPayload { pair_id })
            .map_err(Into::into)
    }

    pub fn set_push_preferences(&self, payload: serde_json::Value) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setPushPreferences", payload)
            .map_err(Into::into)
    }

    pub fn set_push_relay_url(&self, url: Option<String>) -> crate::Result<()> {
        self.0
            .run_mobile_plugin("setPushRelayURL", SetPushRelayUrlPayload { url })
            .map_err(Into::into)
    }

    pub fn set_push_credentials(&self, channel: String, device: String, secret: String) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("setPushCredentials", SetPushCredentialsPayload { channel, device, secret })
            .map_err(Into::into)
    }

    pub fn clear_push_pairing(&self) -> crate::Result<serde_json::Value> {
        self.0
            .run_mobile_plugin("clearPushPairing", ())
            .map_err(Into::into)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SharePayload {
    text: Option<String>,
    url: Option<String>,
}

#[derive(Serialize)]
struct TestPushPayload {
    href: Option<String>,
}

#[derive(Serialize)]
struct BeginPushPairingPayload {
    version: Option<String>,
}

#[derive(Serialize)]
struct GetPushPairingPayload {
    #[serde(rename = "pair_id")]
    pair_id: Option<String>,
}

#[derive(Serialize)]
struct SetPushRelayUrlPayload {
    url: Option<String>,
}

#[derive(Serialize)]
struct SetPushCredentialsPayload {
    channel: String,
    device: String,
    secret: String,
}
