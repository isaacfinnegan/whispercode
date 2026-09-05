import type { Platform } from "../../../../../app/src/context/platform"

const value: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  back() {},
  forward() {},
  notify: async (title, description, href, opts) => {
    void title
    void description
    void href
    void opts
  },
  setPushRelayURL: async (url) => {
    void url
  },
  fetch: globalThis.fetch.bind(globalThis),
}

export function usePlatform() {
  return value
}
