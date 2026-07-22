import { describe, expect, test } from "bun:test"
import { promptInputV2TextLength } from "./cursor"

const text = (content: string) => ({ nodeType: 3, textContent: content, childNodes: [] }) as unknown as Node

const element = (tagName: string, children: Node[] = []) =>
  ({
    nodeType: 1,
    tagName,
    textContent: children.map((child) => child.textContent ?? "").join(""),
    childNodes: children,
  }) as unknown as Node

describe("promptInputV2TextLength", () => {
  test("counts a preceding break in the persisted cursor coordinate", () => {
    const fragment = element("DIV", [text("foo"), element("BR"), text("bar")])

    expect(promptInputV2TextLength(fragment)).toBe(7)
  })

  test("ignores zero-width characters like the editor helpers", () => {
    expect(promptInputV2TextLength(text("a\u200Bb"))).toBe(2)
  })
})
