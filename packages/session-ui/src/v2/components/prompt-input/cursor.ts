export function promptInputV2TextLength(node: Node): number {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === 1 && (node as Element).tagName === "BR") return 1
  return Array.from(node.childNodes).reduce((length, child) => length + promptInputV2TextLength(child), 0)
}

export function promptInputV2Cursor(editor: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return promptInputV2TextLength(editor)
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)
  return promptInputV2TextLength(range.cloneContents())
}
