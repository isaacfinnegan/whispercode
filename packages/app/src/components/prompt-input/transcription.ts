import type { Prompt, TextPart } from "@/context/prompt"

/**
 * Appends transcription text to the prompt parts array, combining with the last text part if present.
 * UPSTREAM-DIVERGENCE-FILE
 */
export function appendTranscription(currentPrompt: Prompt, text: string): Prompt {
  const lastPartIndex = currentPrompt.length - 1
  const lastPart = currentPrompt[lastPartIndex]
  const next: Prompt = (() => {
    if (lastPart && lastPart.type === "text") {
      const lastContent = lastPart.content
      const separator = lastContent && !/\s$/.test(lastContent) ? " " : ""
      const updatedLastPart: TextPart = {
        ...lastPart,
        content: lastContent + separator + text,
      }
      return [...currentPrompt.slice(0, lastPartIndex), updatedLastPart]
    }

    return [...currentPrompt, { type: "text", content: text, start: 0, end: text.length }]
  })()

  let offset = 0
  return next.map((part) => {
    if (!("content" in part)) return part
    const normalized = { ...part, start: offset, end: offset + part.content.length }
    offset = normalized.end
    return normalized
  })
}
