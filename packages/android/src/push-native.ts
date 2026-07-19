import type { PairInfo, Platform, PushDiag, PushState } from "@opencode-ai/app"

type PushRegistration = Awaited<ReturnType<NonNullable<Platform["getPushRegistration"]>>>

export const normalizeRegistration = (value: unknown): PushRegistration | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const prefs = input.prefs
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return null
  const settings = prefs as Record<string, unknown>
  if (
    Object.keys(input).some(
      (key) => !["version", "device", "provider", "token", "token_generation", "prefs"].includes(key),
    ) ||
    Object.keys(settings).some((key) => !["complete", "approval", "question", "error"].includes(key)) ||
    input.version !== 1 ||
    typeof input.device !== "string" ||
    !input.device ||
    input.provider !== "fcm" ||
    typeof input.token !== "string" ||
    !input.token ||
    typeof input.token_generation !== "number" ||
    !Number.isSafeInteger(input.token_generation) ||
    input.token_generation < 0 ||
    typeof settings.complete !== "boolean" ||
    typeof settings.approval !== "boolean" ||
    typeof settings.question !== "boolean" ||
    typeof settings.error !== "boolean"
  ) {
    return null
  }
  return {
    version: 1,
    device: input.device,
    provider: "fcm",
    token: input.token,
    token_generation: input.token_generation,
    prefs: {
      complete: settings.complete,
      approval: settings.approval,
      question: settings.question,
      error: settings.error,
    },
  }
}

export const normalizePush = (value: unknown): PushState | null => {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const permission = input.permission
  if (
    typeof input.supported !== "boolean" ||
    (permission !== "unsupported" &&
      permission !== "not-determined" &&
      permission !== "denied" &&
      permission !== "authorized" &&
      permission !== "provisional" &&
      permission !== "ephemeral") ||
    typeof input.allowed !== "boolean" ||
    typeof input.registered !== "boolean" ||
    typeof input.paired !== "boolean" ||
    typeof input.generic !== "boolean"
  ) {
    return null
  }
  return {
    supported: input.supported,
    permission,
    allowed: input.allowed,
    registered: input.registered,
    paired: input.paired,
    generic: input.generic,
    channel: typeof input.channel === "string" ? input.channel : undefined,
    diag: normalizeDiag(input.diag) ?? undefined,
  }
}

export const initializeNativePush = async (
  ready: Promise<unknown>,
  send: (method: string) => Promise<unknown>,
  setPush: (state: PushState) => void,
) => {
  await ready
  await send("pushListenersReady")
  const next = normalizePush(await send("getPushState"))
  if (next) setPush(next)
}

export const revokeNativePushListeners = async (send: (method: string) => Promise<unknown>) => {
  await send("pushListenersNotReady").catch(() => undefined)
}

export const normalizeDiag = (value: unknown): PushDiag | null => {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const pair = input.pairStatus
  return {
    token: input.token === true,
    tokenPending: input.tokenPending === true,
    relay: typeof input.relay === "string" ? input.relay : undefined,
    device: typeof input.device === "string" ? input.device : undefined,
    pairID: typeof input.pairID === "string" ? input.pairID : undefined,
    pairStatus:
      pair === "pending" || pair === "claimed" || pair === "active" || pair === "expired" || pair === "failed"
        ? pair
        : undefined,
    pairExpires: typeof input.pairExpires === "string" ? input.pairExpires : undefined,
    lastCode: typeof input.lastCode === "string" ? input.lastCode : undefined,
    lastError: typeof input.lastError === "string" ? input.lastError : undefined,
  }
}

export const normalizePair = (value: unknown): PairInfo | null => {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const status = input.status
  if (
    status !== "pending" &&
    status !== "claimed" &&
    status !== "active" &&
    status !== "expired" &&
    status !== "failed"
  )
    return null
  const id = typeof input.id === "string" ? input.id : undefined
  if (!id && status !== "active") return null
  return {
    id: id ?? "active",
    status,
    token: typeof input.token === "string" ? input.token : undefined,
    command: typeof input.command === "string" ? input.command : undefined,
    expires: typeof input.expires === "string" ? input.expires : undefined,
    channel: typeof input.channel === "string" ? input.channel : undefined,
    device: typeof input.device === "string" ? input.device : undefined,
    message: typeof input.message === "string" ? input.message : undefined,
  }
}

export const isPushHref = (href: string) => {
  if (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")) return true
  try {
    const url = new URL(href)
    return url.protocol === "opencode:" && (url.hostname === "open-project" || url.hostname === "new-session")
  } catch {
    return false
  }
}

export const routePushHref = (href: string, navigate: (href: string) => void, deepLink: (href: string) => void) => {
  if (!isPushHref(href)) return false
  if (href.startsWith("opencode://")) deepLink(href)
  else navigate(href)
  return true
}

export const queuePushDeepLink = (
  target: { __OPENCODE__?: { deepLinks?: string[] } },
  href: string,
  dispatch: (href: string) => void,
) => {
  target.__OPENCODE__ ??= {}
  const pending = target.__OPENCODE__.deepLinks ?? []
  target.__OPENCODE__.deepLinks = [...pending, href]
  dispatch(href)
}
