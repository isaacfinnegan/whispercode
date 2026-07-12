import { describe, expect, test } from "bun:test"
import { appendTranscription } from "./transcription"
import type { Prompt } from "@/context/prompt"

describe("appendTranscription", () => {
  test("appends a new text part when prompt is empty or ends with non-text", () => {
    const emptyPrompt: Prompt = []
    expect(appendTranscription(emptyPrompt, "hello")).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])

    const imagePrompt: Prompt = [
      { type: "image", id: "1", filename: "image.png", mime: "image/png", dataUrl: "data:..." },
    ]
    expect(appendTranscription(imagePrompt, "hello")).toEqual([
      { type: "image", id: "1", filename: "image.png", mime: "image/png", dataUrl: "data:..." },
      { type: "text", content: "hello", start: 0, end: 5 },
    ])
  })

  test("appends to the last text part, inserting a space if necessary", () => {
    const promptWithText: Prompt = [{ type: "text", content: "hello", start: 0, end: 5 }]
    expect(appendTranscription(promptWithText, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 5 },
    ])

    const promptWithTextAndSpace: Prompt = [{ type: "text", content: "hello ", start: 0, end: 6 }]
    expect(appendTranscription(promptWithTextAndSpace, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 6 },
    ])
  })
})
