use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
mod models;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

pub use error::{Error, Result};
pub use models::ScanResult;

#[cfg(desktop)]
pub use desktop::MobileBridge;
#[cfg(mobile)]
pub use mobile::MobileBridge;

pub trait MobileBridgeExt<R: Runtime> {
    fn mobile_bridge(&self) -> &MobileBridge<R>;
}

impl<R: Runtime, T: Manager<R>> crate::MobileBridgeExt<R> for T {
    fn mobile_bridge(&self) -> &MobileBridge<R> {
        self.state::<MobileBridge<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-bridge")
        .invoke_handler(tauri::generate_handler![
            commands::is_whisper_ready,
            commands::start_recording,
            commands::stop_recording,
            commands::scan_network,
            commands::cancel_scan,
            commands::share,
            commands::get_push_state,
            commands::push_listeners_ready,
            commands::request_push_permission,
            commands::open_system_settings,
            commands::test_push,
            commands::begin_push_pairing,
            commands::get_push_pairing,
            commands::set_push_preferences,
            commands::set_push_relay_url,
            commands::set_push_credentials,
            commands::clear_push_pairing
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let bridge = mobile::init(app, api)?;
            #[cfg(desktop)]
            let bridge = desktop::init(app, api)?;
            app.manage(bridge);
            Ok(())
        })
        .build()
}
