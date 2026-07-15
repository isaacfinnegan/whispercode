import { addPluginListener, invoke } from "@tauri-apps/api/core"

const commands = {
  isWhisperReady: "is_whisper_ready",
  startRecording: "start_recording",
  stopRecording: "stop_recording",
  scanNetwork: "scan_network",
  cancelScan: "cancel_scan",
  share: "share",
  getPushState: "get_push_state",
  requestPushPermission: "request_push_permission",
  openSystemSettings: "open_system_settings",
  testPush: "test_push",
  beginPushPairing: "begin_push_pairing",
  getPushPairing: "get_push_pairing",
  setPushPreferences: "set_push_preferences",
  setPushRelayURL: "set_push_relay_url",
  setPushCredentials: "set_push_credentials",
  clearPushPairing: "clear_push_pairing",
} as const

const resolve = (method: string) => {
  if (method in commands) return commands[method as keyof typeof commands]
}

type Invoker = <T>(command: string, params?: Record<string, unknown>) => Promise<T>
type Listener = { unregister: () => Promise<void> }
type ListenerRegistrar = (plugin: string, event: string, handler: (payload: unknown) => void) => Promise<Listener>

export const createBridge = (call: Invoker, listen: ListenerRegistrar = addPluginListener) => {
  const sendAsync = <T = unknown>(method: string, params?: unknown) => {
    const command = resolve(method)
    if (!command) return Promise.resolve(null)
    return call<T>(`plugin:mobile-bridge|${command}`, params as Record<string, unknown>).then((value) => value ?? null)
  }

  return {
    available: () => true,
    send: (method: string, params?: unknown) => {
      void sendAsync(method, params).catch(() => undefined)
    },
    sendAsync,
    on: (type: string, handler: (payload: unknown) => void) => {
      let active = true
      let listener: Listener | null = null

      const ready = listen("mobile-bridge", type, (payload) => {
        if (!active) return
        handler(payload)
      }).then((value) => {
        if (active) {
          listener = value
          return
        }
        void value.unregister().catch(() => undefined)
      })
      void ready.catch(() => undefined)

      const stop = () => {
        active = false
        if (!listener) return
        void listener.unregister().catch(() => undefined)
      }
      return Object.assign(stop, { ready })
    },
  }
}

export const bridge = createBridge(invoke)
