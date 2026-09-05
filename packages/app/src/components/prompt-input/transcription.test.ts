import { describe, expect, test } from "bun:test"
import { appendTranscription } from "./transcription"
import type { Prompt } from "@/context/prompt"

describe("appendTranscription", () => {
  test("appends a new text part when prompt is empty or ends with an image", () => {
    const emptyPrompt: Prompt = []
    expect(appendTranscription(emptyPrompt, "hello")).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])

    const imagePrompt: Prompt = [
      { type: "image", id: "1", filename: "image.png", mime: "image/png", blob: { id: "blob-1", url: "blob:test" } },
    ]
    expect(appendTranscription(imagePrompt, "hello")).toEqual([
      { type: "image", id: "1", filename: "image.png", mime: "image/png", blob: { id: "blob-1", url: "blob:test" } },
      { type: "text", content: "hello", start: 0, end: 5 },
    ])
  })

  test("appends trailing text after a structured mention with normalized offsets", () => {
    const prompt: Prompt = [{ type: "agent", name: "reviewer", content: "@reviewer", start: 4, end: 13 }]

    expect(appendTranscription(prompt, "hello")).toEqual([
      { type: "agent", name: "reviewer", content: "@reviewer", start: 0, end: 9 },
      { type: "text", content: "hello", start: 9, end: 14 },
    ])
  })

  test("extends trailing text and normalizes stale offsets", () => {
    const prompt: Prompt = [
      { type: "file", path: "src", content: "@src", start: 8, end: 12 },
      { type: "text", content: "hello", start: 20, end: 25 },
    ]

    expect(appendTranscription(prompt, "world")).toEqual([
      { type: "file", path: "src", content: "@src", start: 0, end: 4 },
      { type: "text", content: "hello world", start: 4, end: 15 },
    ])
  })

  test("appends to the last text part, inserting a space if necessary", () => {
    const promptWithText: Prompt = [{ type: "text", content: "hello", start: 0, end: 5 }]
    expect(appendTranscription(promptWithText, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 11 },
    ])

    const promptWithTextAndSpace: Prompt = [{ type: "text", content: "hello ", start: 0, end: 6 }]
    expect(appendTranscription(promptWithTextAndSpace, "world")).toEqual([
      { type: "text", content: "hello world", start: 0, end: 11 },
    ])
  })
})
