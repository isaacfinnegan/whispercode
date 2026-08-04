type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const queueDeepLink = (target: Window, uri: string, emit: (uri: string) => void) => {
  const window = target as OpenCodeWindow
  window.__OPENCODE__ ??= {}
  window.__OPENCODE__.deepLinks ??= []
  window.__OPENCODE__.deepLinks.push(uri)
  emit(uri)
}

export const initializeDeepLinks = async (ready: Promise<unknown>, send: (method: string) => Promise<unknown>) => {
  await ready
  await send("deepLinkListenersReady")
}
