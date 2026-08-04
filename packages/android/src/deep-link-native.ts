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

let lifecycleCommands = Promise.resolve()

const queueLifecycleCommand = <T>(command: () => Promise<T>) => {
  const result = lifecycleCommands.then(command, command)
  lifecycleCommands = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export const createDeepLinkLifecycle = (input: {
  ready: Promise<unknown>
  send: (method: string) => Promise<unknown>
  stop: () => void
}) => {
  let acknowledged = false
  let disposed = false
  let disposal: Promise<void> | undefined

  const ready = input.ready.then(() =>
    queueLifecycleCommand(async () => {
      if (disposed) return
      await input.send("deepLinkListenersReady")
      acknowledged = true
    }),
  )

  const dispose = () => {
    if (disposal) return disposal
    disposed = true
    disposal = queueLifecycleCommand(async () => {
      try {
        if (acknowledged) await input.send("deepLinkListenersNotReady")
      } finally {
        input.stop()
      }
    })
    return disposal
  }

  return { ready, dispose }
}
