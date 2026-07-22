export function isPromptInputV2Block(node: Node): boolean {
  return node.nodeType === 1 && ["DIV", "P"].includes((node as Element).tagName)
}

export function promptInputV2NodeText(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? "").replace(/\u200B/g, "")
  if (node.nodeType === 1 && (node as Element).tagName === "BR") return "\n"
  return Array.from(node.childNodes).map(promptInputV2NodeText).join("")
}

export function promptInputV2Text(node: Node): string {
  if (node.nodeType === 3 || (node.nodeType === 1 && (node as Element).tagName === "BR")) {
    return promptInputV2NodeText(node)
  }
  const children = Array.from(node.childNodes)
  return children
    .map(
      (child, index) =>
        promptInputV2NodeText(child) + (isPromptInputV2Block(child) && index < children.length - 1 ? "\n" : ""),
    )
    .join("")
}

export function promptInputV2TextLength(node: Node): number {
  return promptInputV2Text(node).length
}

export function promptInputV2Cursor(editor: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return promptInputV2TextLength(editor)
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(editor)
  range.setEnd(selection.anchorNode!, selection.anchorOffset)
  return promptInputV2TextLength(range.cloneContents())
}
