# Wrap Plan Files in Chat Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure plan files and other markdown documentation files wrap their text in the write tool output within the chat window, preventing horizontal scroll for readable prose.

**Architecture:** Detect if the file being written by the `write` tool is a markdown/plan file (using its extension `.md`, `.markdown`, or directory `/plans/`) and dynamically set the `overflow` prop on the file viewer component to `"wrap"` instead of forcing `"scroll"`.

**Tech Stack:** TypeScript, SolidJS, OpenCode Session UI.

---

### Task 1: Update Write Tool Component

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx:2055-2113`

- [ ] **Step 1: Inspect the write tool code**
Confirm the lines around `packages/session-ui/src/components/message-part.tsx` where the `write` tool registry is defined.

- [ ] **Step 2: Modify the write tool to conditionally wrap plan/markdown files**
Update `packages/session-ui/src/components/message-part.tsx` to dynamically determine the `overflow` option.

```tsx
ToolRegistry.register({
  name: "write",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const path = createMemo(() => props.input.filePath || "")
    const filename = () => getFilename(props.input.filePath ?? "")
    const pending = () => props.status === "pending" || props.status === "running"
    const isPlanOrMarkdown = createMemo(() => {
      const p = path()
      return p.endsWith(".md") || p.endsWith(".markdown") || p.includes("/plans/")
    })
    return (
      <div data-component="write-tool">
        <BasicTool
          {...props}
          icon="code-lines"
          defer={props.deferContent !== false}
          trigger={
            <div data-component="write-trigger">
              <div data-slot="message-part-title-area">
                <div data-slot="message-part-title">
                  <span data-slot="message-part-title-text">
                    <TextShimmer text={i18n.t("ui.messagePart.title.write")} active={pending()} />
                  </span>
                  <Show when={!pending()}>
                    <span data-slot="message-part-title-filename">{filename()}</span>
                  </Show>
                </div>
                <Show when={!pending() && props.input.filePath?.includes("/")}>
                  <div data-slot="message-part-path">
                    <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                  </div>
                </Show>
              </div>
              <div data-slot="message-part-actions">{/* <DiffChanges diff={diff} /> */}</div>
            </div>
          }
        >
          <Show when={props.input.content && path()}>
            <ToolFileAccordion path={path()}>
              <div data-component="write-content">
                <Dynamic
                  component={fileComponent}
                  mode="text"
                  file={{
                    name: props.input.filePath,
                    contents: props.input.content,
                    cacheKey: checksum(props.input.content),
                  }}
                  overflow={isPlanOrMarkdown() ? "wrap" : "scroll"}
                  onRendered={props.onContentRendered}
                />
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </BasicTool>
      </div>
    )
  },
})
```

- [ ] **Step 3: Run the local test suite**
Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/session-ui test`
Expected: Passes all tests.

- [ ] **Step 4: Run typecheck**
Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/session-ui typecheck && rtk bun run typecheck`
Expected: Build and typechecks finish with exit code 0.

- [ ] **Step 5: Run package app tests**
Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/app test:unit`
Expected: Passes all unit tests.

- [ ] **Step 6: Commit changes**
Run:
```bash
rtk git add packages/session-ui/src/components/message-part.tsx
rtk git commit -m "feat(session-ui): conditionally line wrap markdown and plan files in write tool"
```
