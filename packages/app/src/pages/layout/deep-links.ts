export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

export type OpenSessionDeepLink = { server: string; session: string }

export const parseOpenSessionDeepLink = (input: string): OpenSessionDeepLink | undefined => {
  if (input.length > 2048 || /%(?![0-9A-Fa-f]{2})/.test(input)) return
  const url = parseUrl(input)
  if (!url || url.protocol !== "opencode:" || url.hostname !== "open-session") return
  if (url.pathname !== "" && url.pathname !== "/") return
  if (url.username || url.password || url.port || url.hash) return
  if ([...url.searchParams.keys()].some((key) => key !== "server" && key !== "session")) return

  const servers = url.searchParams.getAll("server")
  const sessions = url.searchParams.getAll("session")
  if (servers.length !== 1 || sessions.length !== 1) return

  const session = sessions[0]?.trim()
  if (!session || session.length > 256 || !/^[A-Za-z0-9_-]+$/.test(session)) return

  const rawServer = servers[0]?.trim()
  if (!rawServer || rawServer.length > 1024) return

  try {
    const server = new URL(rawServer)
    if (server.protocol !== "http:" && server.protocol !== "https:") return
    if (server.username || server.password || server.search || server.hash) return
    server.pathname = server.pathname.replace(/\/+$/, "")
    return { server: server.toString().replace(/\/$/, ""), session }
  } catch {
    return
  }
}

export const collectOpenSessionDeepLinks = (urls: string[]) =>
  urls.map(parseOpenSessionDeepLink).filter((link): link is OpenSessionDeepLink => !!link)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}

export const acknowledgePendingDeepLinks = (target: OpenCodeWindow, urls: string[]) => {
  const pending = target.__OPENCODE__?.deepLinks
  if (!pending?.length || urls.length === 0) return
  const delivered = new Map<string, number>()
  for (const url of urls) delivered.set(url, (delivered.get(url) ?? 0) + 1)
  target.__OPENCODE__!.deepLinks = pending.filter((url) => {
    const count = delivered.get(url) ?? 0
    if (count === 0) return true
    delivered.set(url, count - 1)
    return false
  })
}
