const MAX_BREAKS = 200
// UPSTREAM-DIVERGENCE-FILE: These editor DOM helpers were added after upstream sync 6b9ce5e63 for the
// fork's mobile keyboard delete-word action. Preserve them when upstream changes cursor math.
const GAP = /\s/

function gap(char?: string) {
  return !!char && GAP.test(char)
}

function pill(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const element = node as HTMLElement
  return (
    element.dataset.type === "file" ||
    element.dataset.type === "agent" ||
    element.dataset.mention === "file" ||
    element.dataset.mention === "agent" ||
    element.dataset.mention === "reference"
  )
}

function text(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "")
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return "\n"

  let value = ""
  for (const child of Array.from(node.childNodes)) {
    value += text(child)
  }
  return value
}

function offset(parent: HTMLElement, node: Node, pos: number) {
  const range = document.createRange()
  range.selectNodeContents(parent)
  range.setEnd(node, pos)
  return getTextLength(range.cloneContents())
}

function word(text: string, pos: number) {
  let start = pos
  let end = pos

  while (start > 0 && !gap(text[start - 1])) start -= 1
  while (end < text.length && !gap(text[end])) end += 1

  if (start === end) return null
  return { start, end }
}

function left(text: string, pos: number) {
  let end = pos
  while (end > 0 && gap(text[end - 1])) end -= 1
  return word(text, end)
}

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let breaks = 0
  for (const char of content) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks > MAX_BREAKS) {
      const tail = content.endsWith("\n")
      const text = tail ? content.slice(0, -1) : content
      if (text) fragment.appendChild(document.createTextNode(text))
      if (tail) fragment.appendChild(document.createElement("br"))
      return fragment
    }
  }

  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    }
    if (index < segments.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function getEditorText(parent: HTMLElement) {
  return text(parent)
}

// UPSTREAM-DIVERGENCE: Mobile delete-word needs selection offsets in editor text coordinates rather
// than the browser's node-local offsets used by the upstream cursor helpers.
export function getSelectionRange(parent: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer) || !parent.contains(range.endContainer)) return null

  return {
    start: offset(parent, range.startContainer, range.startOffset),
    end: offset(parent, range.endContainer, range.endOffset),
  }
}

export function getDeleteWordRange(text: string, range?: { start: number; end: number } | null) {
  if (!text) return null

  if (range && range.start !== range.end) {
    const start = Math.max(0, Math.min(range.start, range.end, text.length))
    const end = Math.max(start, Math.min(Math.max(range.start, range.end), text.length))
    return { start, end }
  }

  const pos = Math.max(0, Math.min(range?.start ?? text.length, text.length))
  let span = null as { start: number; end: number } | null

  if (pos > 0 && pos < text.length && !gap(text[pos - 1]) && !gap(text[pos])) {
    span = word(text, pos)
  } else if (pos > 0) {
    span = left(text, pos)
  }

  if (!span) return null

  let end = span.end
  while (end < text.length && gap(text[end])) end += 1
  if (end > span.end) return { start: span.start, end }

  let start = span.start
  while (start > 0 && gap(text[start - 1])) start -= 1
  return { start, end: span.end }
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  const range = document.createRange()
  setSelectionRange(parent, range, position)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function setSelectionRange(parent: HTMLElement, range: Range, start: number, end = start) {
  // UPSTREAM-DIVERGENCE: The fork's native keyboard shortcut selects a deletion span before mutating
  // the DOM, so we need a sibling helper to set both edges using the upstream range traversal logic.
  const length = getTextLength(parent)
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(from, Math.min(end, length))

  range.selectNodeContents(parent)
  range.collapse(false)
  setRangeEdge(parent, range, "start", from)
  setRangeEdge(parent, range, "end", to)
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  const visit = (node: Node): boolean => {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = pill(node)
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      if (edge === "end") range.setEnd(node, remaining)
      return true
    }

    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start" && remaining < length) range.setStartBefore(node)
      if (edge === "start" && remaining === length) range.setStartAfter(node)
      if (edge === "end" && remaining === 0) range.setEndBefore(node)
      if (edge === "end" && remaining > 0) range.setEndAfter(node)
      return true
    }

    if (isText || isPill || isBreak) {
      remaining -= length
      return false
    }

    return Array.from(node.childNodes).some(visit)
  }

  Array.from(parent.childNodes).some(visit)
}
