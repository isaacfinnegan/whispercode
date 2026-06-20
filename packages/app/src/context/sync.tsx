import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import { createMemo } from "solid-js"
import { Binary } from "@opencode-ai/core/util/binary"
import { useServerSync } from "./server-sync"
import { copyTodos, todoMode } from "./todo-store"
import { useSDK } from "./sdk"
import type { Message, Part, Todo, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"

type OptimisticItem = {
  message: Message
  parts: Part[]
}

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

export interface OptimisticAddInput {
  sessionID: string
  message: Message
  parts: Part[]
}

export interface OptimisticRemoveInput {
  sessionID: string
  messageID: string
}

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function setOptimistic(directory: string, sessionID: string, input: { message: Message; parts: Part[] }) {
  // noop
}

export function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    const next = messages ? [...messages] : []
    const result = Binary.search(next, input.message.id, (m) => m.id)
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  } else {
    draft.message[input.sessionID] = [input.message]
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

export const useSync = () => {
  const serverSync = useServerSync()
  const sdk = useSDK()

  return createMemo(() => serverSync().createDirSyncContext(sdk().directory))
}

export type DirectorySync = ReturnType<ReturnType<typeof useSync>>
