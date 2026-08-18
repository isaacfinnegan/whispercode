import type { Platform } from "../../../../../app/src/context/platform"

const value: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  back() {},
  forward() {},
  notify: async () => {},
  setPushRelayURL: async (url) => {
    void url
  },
  fetch: globalThis.fetch.bind(globalThis),
}

export function usePlatform() {
  return value
}
