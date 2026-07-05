# Upstream Sync & Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync whispercode with upstream sst/opencode changes, upgrade packages (including effect and venice-ai-sdk-provider), and resolve overlapping customizations cleanly.

**Architecture:** Merge changes from local upstream repository (remote `upstream` at `../opencode`), resolving conflicts by keeping WhisperCode's mobile fork features (push integration, mobile UI adjustments, virtual keyboard suppression, haptic cues) while adopting upstream improvements (reference indexing, MCP autocomplete, scroll active commands, new layout updates). Run validation/typecheck steps and update versions.

**Tech Stack:** Bun, TypeScript, Solid, Effect, Tauri.

---

### Task 1: Commit Local Modifications and Merge Upstream Branch

**Files:**
- Modify: `packages/opencode/src/server/shared/ui.ts` (Commit existing local changes)
- Modify: `packages/session-ui/src/components/file.tsx` (Commit existing local changes)
- Modify: `packages/session-ui/src/components/file.css` (Commit existing local changes)
- Modify: `packages/session-ui/src/components/markdown.css` (Commit existing local changes)

- [ ] **Step 1: Commit existing local modifications**

Run:
```bash
rtk git add packages/opencode/src/server/shared/ui.ts \
  packages/session-ui/src/components/file.tsx \
  packages/session-ui/src/components/file.css \
  packages/session-ui/src/components/markdown.css
rtk git commit -m "feat(mobile): save local plan viewer and path correction modifications"
```

- [ ] **Step 2: Fetch upstream changes from local opencode repository**

Run: `rtk git fetch upstream dev`
Expected: Success, fetching latest refs.

- [ ] **Step 3: Initiate the merge of upstream dev branch**

Run: `rtk git merge upstream/dev`
Expected: Conflicts will be reported in files like `prompt-input.tsx`, `event-reducer.ts`, `session-header.tsx`, `serve.ts`, `server.ts`, `markdown.css`, `home.tsx`, `app.tsx`.

---

### Task 2: Resolve Conflict in `packages/cli/src/commands/handlers/serve.ts`

**Files:**
- Modify: `packages/cli/src/commands/handlers/serve.ts`

- [ ] **Step 1: Open `packages/cli/src/commands/handlers/serve.ts` and inspect conflict**

Resolve the import and layer dependency configuration by adopting the upstream node builder format since `defaultLayer` aliases have been removed upstream.

Replace:
```typescript
<<<<<<< HEAD
      Layer.provide(Credential.defaultLayer),
      Layer.provide(PermissionSaved.defaultLayer),
=======
      Layer.provide(AppNodeBuilder.build(LayerNode.group([Credential.node, PermissionSaved.node]))),
>>>>>>> upstream/dev
```
With:
```typescript
      Layer.provide(AppNodeBuilder.build(LayerNode.group([Credential.node, PermissionSaved.node]))),
```
Ensure imports for `AppNodeBuilder` and `LayerNode` are restored at the top of the file:
```typescript
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/cli/src/commands/handlers/serve.ts`

---

### Task 3: Resolve Conflict in `packages/opencode/src/server/server.ts`

**Files:**
- Modify: `packages/opencode/src/server/server.ts`

- [ ] **Step 1: Open `packages/opencode/src/server/server.ts` and inspect conflict**

Resolve by replacing `WebSocketTracker.layer` with upstream's node builder wrapping:

Replace:
```typescript
<<<<<<< HEAD
    Layer.provideMerge(WebSocketTracker.layer),
=======
    Layer.provideMerge(AppNodeBuilder.build(WebSocketTracker.node)),
>>>>>>> upstream/dev
```
With:
```typescript
    Layer.provideMerge(AppNodeBuilder.build(WebSocketTracker.node)),
```
Ensure `AppNodeBuilder` import is included at the top:
```typescript
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/opencode/src/server/server.ts`

---

### Task 4: Resolve Conflict in `packages/app/src/context/global-sync/event-reducer.ts`

**Files:**
- Modify: `packages/app/src/context/global-sync/event-reducer.ts`

- [ ] **Step 1: Open `packages/app/src/context/global-sync/event-reducer.ts` and inspect conflict**

Keep local customization `copyTodos(props.todos)` under `todo.updated` case while adopting upstream's `loadReferences` updates.

Ensure the case `todo.updated` is written as:
```typescript
    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      // UPSTREAM-DIVERGENCE: Copy todo payloads before writing them so the fork's resume logic can
      // safely share session_todo cache state across stores without reference reuse bugs.
      input.setStore("todo", props.sessionID, copyTodos(props.todos))
      input.setSessionTodo?.(props.sessionID, props.todos)
      break
    }
```
And make sure `loadReferences?: () => void` is included in the `Input` type signature, and case `reference.updated` is adopted:
```typescript
    case "reference.updated": {
      input.loadReferences?.()
      break
    }
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/app/src/context/global-sync/event-reducer.ts`

---

### Task 5: Resolve Conflict in `packages/app/src/components/session/session-header.tsx`

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`

- [ ] **Step 1: Open `packages/app/src/components/session/session-header.tsx` and inspect conflict**

Merge upstream changes by adopting the new memo properties and action parameters while retaining mobile fork adjustments.

1. Keep custom OS types:
```typescript
type OS = "macos" | "windows" | "linux" | "ios" | "android" | "unknown"
```

2. Keep memos for `mobile`, `isDesktopV2`, and `term`:
```typescript
  const mobile = createMemo(() => platform.platform === "ios" || platform.platform === "android")
  const isDesktopV2 = createMemo(
    () => (platform.platform === "desktop" || platform.platform === "web") && settings.general.newLayoutDesigns(),
  )
  const search = createMemo(() => (isDesktopV2() ? settings.general.showSearch() : true))
  const tree = createMemo(() => (isDesktopV2() ? settings.general.showFileTree() : true))
  const term = createMemo(() => settings.general.showTerminal())
  const status = createMemo(() => (isDesktopV2() ? settings.general.showStatus() : true))
```

3. Keep mobile refresh and restart mechanism:
```typescript
  const refresh = () => {
    platform.haptic?.("light")
    void platform.restart()
  }
```
and its rendering under classic layout:
```typescript
                    <Show when={mobile()}>
                      <IconButton
                        icon="reset"
                        variant="ghost"
                        class="titlebar-icon w-6 h-6 p-0 box-border shrink-0"
                        onClick={refresh}
                        aria-label={language.t("session.header.refresh")}
                        data-action="session-refresh"
                      />
                    </Show>
```

4. Keep gated terminal toggle button wrapper `<Show when={term()}>` in classic layout.

5. Keep the custom properties in `SessionHeaderV2ActionsState` interface and action handler:
```typescript
interface SessionHeaderV2ActionsState {
  // ...
  termVisible: boolean
  terminalOpened: boolean
  onTerminalToggle: () => void
  onMcpToggle: () => void
}
```
And render the terminal button within `SessionHeaderV2Actions` if `termVisible` is true:
```typescript
      <Show when={props.state.termVisible}>
        <TooltipKeybind title={language.t("command.terminal.toggle")} keybind={command.keybind("terminal.toggle")}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="large"
            class="!w-9 shrink-0"
            state={props.state.terminalOpened ? "pressed" : undefined}
            onClick={props.state.onTerminalToggle}
            aria-label={language.t("command.terminal.toggle")}
            aria-expanded={props.state.terminalOpened}
            aria-controls="terminal-panel"
            icon={<IconV2 name="terminal" />}
          />
        </TooltipKeybind>
      </Show>
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/app/src/components/session/session-header.tsx`

---

### Task 6: Resolve Conflict in `packages/app/src/components/prompt-input.tsx`

**Files:**
- Modify: `packages/app/src/components/prompt-input.tsx`

- [ ] **Step 1: Open `packages/app/src/components/prompt-input.tsx` and inspect conflict**

Resolve by adopting upstream reference completion features, popover updates, and ArrowUp/ArrowDown changes, while keeping mobile swipe/touch events, focus gates, deleteWord keyboard command listener, and microphone voice settings.

1. Keep touch start/move/end/cancel handler setup:
```typescript
  let touchStartX = 0
  let touchStartY = 0
  let touchStartTime = 0

  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    touchStartTime = Date.now()
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (touchStartTime === 0) return
    const touch = e.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - touchStartX
    const deltaY = touch.clientY - touchStartY
    const deltaTime = Date.now() - touchStartTime

    if (deltaX < -50 && Math.abs(deltaY) < 25 && deltaTime < 300) {
      if (store.mode === "normal" && isMobilePlatform(platform) && platform.startVoiceInput) {
        ;(platform as { vibrate?: () => void }).vibrate?.()
        void platform.startVoiceInput()
        touchStartX = 0
        touchStartY = 0
        touchStartTime = 0
      }
    }
  }

  const handleTouchEnd = () => {
    touchStartX = 0
    touchStartY = 0
    touchStartTime = 0
  }
```

2. Keep `safeFocus()` wrapper and apply it to replace `.focus()` calls to prevent keyboard popup on mobile platforms:
```typescript
  const safeFocus = () => {
    if (!editorRef) return
    const isMobile = isMobilePlatform(platform)
    if (isMobile && document.activeElement !== editorRef) return
    editorRef.focus()
  }
```

3. Wrap upstream's `handleFocus` function with the `isMobilePlatform` check:
```typescript
  const handleFocus = () => {
    if (!restoreEndOnFocus) return
    restoreEndOnFocus = false
    const isMobile = isMobilePlatform(platform)
    if (isMobile && document.activeElement !== editorRef) return
    requestAnimationFrame(() => {
      if (document.activeElement !== editorRef) return
      setCursorPosition(editorRef, prompt.cursor() ?? promptLength(prompt.current()))
      queueScroll()
    })
  }
```

4. Keep the voice transcription event listener:
```typescript
  createEffect(() => {
    const handleTranscription = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { text?: string; isFinal?: boolean } | undefined
      if (!detail?.text) return
      if (detail.isFinal === false) return
      if (!editorRef) return

      editorRef.focus()
      setCursorPosition(editorRef, promptLength(prompt.current()))
      addPart({ type: "text", content: detail.text, start: 0, end: 0 })
    }

    window.addEventListener("opencode:transcription", handleTranscription)
    onCleanup(() => window.removeEventListener("opencode:transcription", handleTranscription))
  })
```

5. Keep the custom `deleteWord` and event listener implementation:
```typescript
  const deleteWord = () => {
    if (!editorRef) return

    const active = document.activeElement
    const focused = active instanceof HTMLElement && active === editorRef
    const selected = getSelectionRange(editorRef)
    if (!focused && !selected) return

    const text = getEditorText(editorRef)
    const span = getDeleteWordRange(text, selected)
    if (!span) return

    const selection = window.getSelection()
    if (!selection) return

    const range = document.createRange()
    editorRef.focus()
    setSelectionRange(editorRef, range, span.start, span.end)
    selection.removeAllRanges()
    selection.addRange(range)
    range.deleteContents()
    setCursorPosition(editorRef, span.start)
    handleInput()
  }

  createEffect(() => {
    const handleDeleteWord = () => {
      deleteWord()
    }

    window.addEventListener("opencode:keyboard-delete-word", handleDeleteWord)
    onCleanup(() => window.removeEventListener("opencode:keyboard-delete-word", handleDeleteWord))
  })
```

6. Adopt upstream `@` references (`referenceList`, `mcpResourceList` createMemos, handling `@reference` and `@resource` in `handleAtSelect`, serializing dataset attributes like `data-source-type` / `data-mime` in `pushFile`).

7. Keep microphone voice input button layout inside `<Show when={store.mode === "normal" && isMobilePlatform(platform) && platform.startVoiceInput}>`.

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/app/src/components/prompt-input.tsx`

---

### Task 7: Resolve Conflict in `packages/app/src/components/dialog-select-model.tsx`

**Files:**
- Modify: `packages/app/src/components/dialog-select-model.tsx`

- [ ] **Step 1: Open `packages/app/src/components/dialog-select-model.tsx` and inspect conflict**

Adopt upstream's new `ModelSelectorPopoverV2` while preserving mobile autofocus prevention logic (preventing the virtual keyboard from popping up on mobile devices when popovers are opened).

1. In the existing `ModelSelectorPopover` content, verify autofocus prevention remains intact:
```typescript
          onOpenAutoFocus={(event) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              event.preventDefault()
            }
          }}
```

2. In the new `ModelSelectorPopoverV2`'s `setOpen` method, wrap the `searchRef?.focus()` inside a check to prevent autofocus on iOS/Android:
```typescript
  const setOpen = (open: boolean) => {
    if (open) {
      restoreTrigger = true
      setStore({ open: true, active: initialActive() })
      setTimeout(() =>
        requestAnimationFrame(() => {
          const platform = document.documentElement.dataset.platform
          if (platform !== "ios" && platform !== "android") {
            searchRef?.focus()
          }
          activeItem()?.scrollIntoView({ block: "nearest" })
        }),
      )
      return
    }
    setStore({ open: false, search: "", active: "" })
  }
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/app/src/components/dialog-select-model.tsx`

---

### Task 8: Resolve Conflicts in `packages/app/src/app.tsx` and `packages/app/src/context/server-sync.tsx`

**Files:**
- Modify: `packages/app/src/app.tsx`
- Modify: `packages/app/src/context/server-sync.tsx`

- [ ] **Step 1: Open `packages/app/src/app.tsx` and inspect conflict**

Ensure the custom providers (`PushRelayProvider` and `PushPairProvider`) are preserved in `SharedProviders` wrapping structure while adopting the upstream routing and layout cleanups.

1. Verify the mobile provider imports remain at the top of the file:
```typescript
import { PushPairProvider } from "@/context/push-pair"
import { usePlatform } from "@/context/platform"
import { PushRelayProvider } from "@/context/push-relay"
```

2. Modify `SharedProviders` to wrap its inner components inside `PushRelayProvider` and `PushPairProvider`:
```typescript
function SharedProviders(props: ParentProps) {
  return (
    <PushRelayProvider>
      <PushPairProvider>
        <BodyDesignClass />
        <CommandProvider>
          <DesktopCommands />
          <HighlightsProvider>{props.children}</HighlightsProvider>
        </CommandProvider>
      </PushPairProvider>
    </PushRelayProvider>
  )
}
```

- [ ] **Step 2: Open `packages/app/src/context/server-sync.tsx` and inspect conflict**

Ensure both `warmSessions` and `loadReferencesQuery` are imported from bootstrap.

Replace:
```typescript
<<<<<<< HEAD
  warmSessions,
=======
  loadReferencesQuery,
>>>>>>> upstream/dev
```
With:
```typescript
  warmSessions,
  loadReferencesQuery,
```

- [ ] **Step 3: Save and stage both files**

Run: `rtk git add packages/app/src/app.tsx packages/app/src/context/server-sync.tsx`

---

### Task 9: Resolve Conflict in `packages/session-ui/src/components/markdown.css`

**Files:**
- Modify: `packages/session-ui/src/components/markdown.css`

- [ ] **Step 1: Open `packages/session-ui/src/components/markdown.css` and inspect conflict**

Resolve by preserving the custom checklist styling for Visual Plan preview (`[data-plan-preview="true"]` rules) and adopting upstream's text wrapping rules and V2 copy button styles.

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/session-ui/src/components/markdown.css`

---

### Task 10: Resolve Conflict in `packages/app/src/pages/home.tsx`

**Files:**
- Modify: `packages/app/src/pages/home.tsx`

- [ ] **Step 1: Open `packages/app/src/pages/home.tsx` and inspect conflict**

Resolve by accepting upstream's layout improvements, sticky header opacity hook, server indicator updates, and scroll view changes while keeping mobile onboarding helper quick start guide link.

Ensure the onboarding block is retained in the empty projects view:
```typescript
      {(platform.platform === "ios" || platform.platform === "android") && (
        <p class="block text-center mt-2 text-12-regular text-text-dimmed">
          {/* UPSTREAM-DIVERGENCE: Keep the mobile quick-start link on the shared home page so server
              onboarding survives upstream empty-state redesigns. */}
          Need help connecting?{" "}
          <a
            class="external-link text-text-link underline"
            href="https://github.com/DNGriffin/whispercode?tab=readme-ov-file#quick-start"
          >
            Quick Start Guide
          </a>
        </p>
      )}
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/app/src/pages/home.tsx`

---

### Task 11: Resolve Conflict in `packages/ui/src/v2/components/icon.tsx`

**Files:**
- Modify: `packages/ui/src/v2/components/icon.tsx`

- [ ] **Step 1: Open `packages/ui/src/v2/components/icon.tsx` and inspect conflict**

Ensure the WhisperCode custom icons `mcp`, `terminal`, and `terminal-active` are preserved while adopting upstream's new `outline-sliders`, `outline-copy`, `outline-square-arrow`, and `reset` icons.

Replace:
```typescript
<<<<<<< HEAD
  mcp: {
    viewBox: "0 0 20 20",
    body: `<g><path d="M0.972656 9.37176L9.5214 1.60019C10.7018 0.527151 12.6155 0.527151 13.7957 1.60019C14.9761 2.67321 14.9761 4.41295 13.7957 5.48599L7.3397 11.3552" stroke="currentColor" stroke-linecap="round"/><path d="M7.42871 11.2747L13.7957 5.48643C14.9761 4.41338 16.8898 4.41338 18.0702 5.48643L18.1147 5.52688C19.2951 6.59993 19.2951 8.33966 18.1147 9.4127L10.3831 16.4414C9.98966 16.7991 9.98966 17.379 10.3831 17.7366L11.9707 19.1799" stroke="currentColor" stroke-linecap="round"/><path d="M11.6587 3.54346L5.33619 9.29119C4.15584 10.3642 4.15584 12.1039 5.33619 13.177C6.51649 14.25 8.43019 14.25 9.61054 13.177L15.9331 7.42923" stroke="currentColor" stroke-linecap="round"/></g>`,
  },
  terminal: {
    viewBox: "0 0 20 20",
    body: `<path d="M6.5 8L8.64286 10L6.5 12M10.9286 12H13.5M2 18H18V2H2V18Z" stroke="currentColor" stroke-linecap="square"/>`,
  },
  "terminal-active": {
    viewBox: "0 0 20 20",
    body: `<path d="M2 18H18V2H2V18Z" fill="currentColor" fill-opacity="0.1"/><path d="M6.5 8L8.64286 10L6.5 12M10.9286 12H13.5M2 18H18V2H2V18Z" stroke="currentColor" stroke-linecap="square"/>`,
  },
=======
  "outline-sliders": {
    viewBox: "0 0 16 16",
    body: `<path d="M11.7779 4.66675H14.4446M11.7779 4.66675C11.7779 5.77132 10.8825 6.66675 9.77789 6.66675C8.67332 6.66675 7.77789 5.77132 7.77789 4.66675M11.7779 4.66675C11.7779 3.56218 10.8825 2.66675 9.77789 2.66675C8.67332 2.66675 7.77789 3.56218 7.77789 4.66675M1.55566 4.66675H7.77789M4.22233 11.3334H1.55566M4.22233 11.3334C4.22233 12.438 5.11776 13.3334 6.22233 13.3334C7.3269 13.3334 8.22233 12.438 8.22233 11.3334M4.22233 11.3334C4.22233 10.2288 5.11776 9.33341 6.22233 9.33341C7.3269 9.33341 8.22233 10.2288 8.22233 11.3334M14.4446 11.3334H8.22233" stroke="currentColor"/>`,
  },
  "outline-copy": {
    viewBox: "0 0 16 16",
    body: `<path d="M4.14908 11.0081H1.76282V1.51758H9.1038V2.55588M14.2225 4.99681H6.75397V14.4873H14.2225V4.99681Z" stroke="currentColor"/>`,
  },
  "outline-square-arrow": {
    viewBox: "0 0 16 16",
    body: `<path d="M13.5555 6.66656V2.44434H9.33326M13.5555 2.44434L7.99993 7.99989M13.5555 9.33324V13.5555C13.5555 13.5555 12.7599 13.5555 11.7777 13.5555H2.44438C2.44438 13.5555 2.44438 12.7599 2.44438 11.7777V4.22213C2.44438 3.2399 2.44434 2.44435 2.44434 2.44435H6.66661" stroke="currentColor"/>`,
  },
  reset: {
    viewBox: "0 0 20 20",
    body: `<path d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10" stroke="currentColor" stroke-linecap="square"/>`,
  },
>>>>>>> upstream/dev
```
With:
```typescript
  mcp: {
    viewBox: "0 0 20 20",
    body: `<g><path d="M0.972656 9.37176L9.5214 1.60019C10.7018 0.527151 12.6155 0.527151 13.7957 1.60019C14.9761 2.67321 14.9761 4.41295 13.7957 5.48599L7.3397 11.3552" stroke="currentColor" stroke-linecap="round"/><path d="M7.42871 11.2747L13.7957 5.48643C14.9761 4.41338 16.8898 4.41338 18.0702 5.48643L18.1147 5.52688C19.2951 6.59993 19.2951 8.33966 18.1147 9.4127L10.3831 16.4414C9.98966 16.7991 9.98966 17.379 10.3831 17.7366L11.9707 19.1799" stroke="currentColor" stroke-linecap="round"/><path d="M11.6587 3.54346L5.33619 9.29119C4.15584 10.3642 4.15584 12.1039 5.33619 13.177C6.51649 14.25 8.43019 14.25 9.61054 13.177L15.9331 7.42923" stroke="currentColor" stroke-linecap="round"/></g>`,
  },
  terminal: {
    viewBox: "0 0 20 20",
    body: `<path d="M6.5 8L8.64286 10L6.5 12M10.9286 12H13.5M2 18H18V2H2V18Z" stroke="currentColor" stroke-linecap="square"/>`,
  },
  "terminal-active": {
    viewBox: "0 0 20 20",
    body: `<path d="M2 18H18V2H2V18Z" fill="currentColor" fill-opacity="0.1"/><path d="M6.5 8L8.64286 10L6.5 12M10.9286 12H13.5M2 18H18V2H2V18Z" stroke="currentColor" stroke-linecap="square"/>`,
  },
  "outline-sliders": {
    viewBox: "0 0 16 16",
    body: `<path d="M11.7779 4.66675H14.4446M11.7779 4.66675C11.7779 5.77132 10.8825 6.66675 9.77789 6.66675C8.67332 6.66675 7.77789 5.77132 7.77789 4.66675M11.7779 4.66675C11.7779 3.56218 10.8825 2.66675 9.77789 2.66675C8.67332 2.66675 7.77789 3.56218 7.77789 4.66675M1.55566 4.66675H7.77789M4.22233 11.3334H1.55566M4.22233 11.3334C4.22233 12.438 5.11776 13.3334 6.22233 13.3334C7.3269 13.3334 8.22233 12.438 8.22233 11.3334M4.22233 11.3334C4.22233 10.2288 5.11776 9.33341 6.22233 9.33341C7.3269 9.33341 8.22233 10.2288 8.22233 11.3334M14.4446 11.3334H8.22233" stroke="currentColor"/>`,
  },
  "outline-copy": {
    viewBox: "0 0 16 16",
    body: `<path d="M4.14908 11.0081H1.76282V1.51758H9.1038V2.55588M14.2225 4.99681H6.75397V14.4873H14.2225V4.99681Z" stroke="currentColor"/>`,
  },
  "outline-square-arrow": {
    viewBox: "0 0 16 16",
    body: `<path d="M13.5555 6.66656V2.44434H9.33326M13.5555 2.44434L7.99993 7.99989M13.5555 9.33324V13.5555C13.5555 13.5555 12.7599 13.5555 11.7777 13.5555H2.44438C2.44438 13.5555 2.44438 12.7599 2.44438 11.7777V4.22213C2.44438 3.2399 2.44434 2.44435 2.44434 2.44435H6.66661" stroke="currentColor"/>`,
  },
  reset: {
    viewBox: "0 0 20 20",
    body: `<path d="M5.83333 4.16406L2.5 7.4974L5.83333 10.8307M3.33333 7.4974H17.9167V15.4141H10" stroke="currentColor" stroke-linecap="square"/>`,
  },
```

- [ ] **Step 2: Save the file and stage it**

Run: `rtk git add packages/ui/src/v2/components/icon.tsx`

---

### Task 12: Resolve Customizations in `packages/app/src/pages/session.tsx` and sub-pages

**Files:**
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/composer/session-question-dock.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`

- [ ] **Step 1: Open `packages/app/src/pages/session.tsx` and inspect conflict**

Ensure the mobile platform checks and review limit bounds are fully integrated into the refactored inner page structure:
1. `mobilePlatform` / `activeReviewLimit` definitions and checks for loading changes.
2. `fallbackGitDiff` and `vcsQuery` custom logic for listing mobile review file limits.
3. Input focus logic bypasses when `isMobilePlatform(platform)` is true:
```typescript
      const isMobile = isMobilePlatform(platform)
      if (!isMobile) {
        inputRef?.focus()
      }
```

Resolve imports conflicts by merging custom mobile tools with new upstream lineage and error helpers:

Conflict 1:
```typescript
import { useTabs } from "@/context/tabs"
import { TerminalProvider, useTerminal } from "@/context/terminal"
import { isMobilePlatform } from "@/components/terminal"
```

Conflict 2:
```typescript
import { same } from "@/utils/same"
import { formatServerError, isSessionNotFoundError } from "@/utils/server-errors"
import { legacySessionHref, requireServerKey, selectSessionLineage, sessionHref } from "@/utils/session-route"
```

- [ ] **Step 2: Inspect `packages/app/src/pages/session/composer/session-question-dock.tsx` after merge**

Ensure that `platform` autofocus gates are preserved in `focusCustom()`:
```typescript
  const focusCustom = (el: HTMLTextAreaElement) => {
    setTimeout(() => {
      const platform = document.documentElement.dataset.platform
      if (platform !== "ios" && platform !== "android") {
        el.focus()
      }
      resizeInput(el)
    }, 0)
  }
```
And in `onMouseDown` handler:
```typescript
              const platform = document.documentElement.dataset.platform
              if (platform === "ios" || platform === "android") return
```

- [ ] **Step 3: Inspect `packages/app/src/pages/session/timeline/message-timeline.tsx` after merge**

Ensure `virtualizer.measure()` has safety protection check:
```typescript
      if (virtualizer && "measure" in virtualizer) {
        ;(virtualizer as any).measure()
      }
```
And that overscroll behavior is applied for mobile scrolling:
```typescript
          "overscroll-behavior-y": "contain",
```

- [ ] **Step 4: Save and stage the files**

Run:
```bash
rtk git add packages/app/src/pages/session.tsx \
  packages/app/src/pages/session/composer/session-question-dock.tsx \
  packages/app/src/pages/session/timeline/message-timeline.tsx
```

---

### Task 13: Complete Merge, Sync Versions, and Run Post-Merge Scripts

**Files:**
- Modify: `packages/client/src/generated/client.ts` (Regenerated)
- Modify: `packages/client/src/generated-effect/client.ts` (Regenerated)
- Modify: `packages/sdk/js/src/v2/gen/types.gen.ts` (Regenerated)

- [ ] **Step 1: Commit the resolved merge**

Run: `rtk git commit -m "merge: sync with upstream/dev up to 7d3f5f3a8"`
Expected: Merge commit created successfully.

- [ ] **Step 2: Synchronize version files**

Run: `bun run script/sync-android-version.ts`
Expected: Android app version is synchronized with `packages/app/package.json` and a `bun install` is run, updating the lockfile to `1.17.13`.

- [ ] **Step 3: Regenerate Client and SDK libraries**

Run:
```bash
./script/generate.ts
bun run --cwd packages/client generate
bun run --cwd packages/sdk/js build
```
Expected: API schema, generated client, and JS SDK files are updated to reflect upstream endpoint structures.

---

### Task 14: Run Diagnostics, Type Check, and Tests

- [ ] **Step 1: Run typechecks**

Run: `bun run typecheck`
Expected: No typecheck errors.

- [ ] **Step 2: Run unit and integration tests**

Run:
```bash
bun run --cwd packages/app test:unit
bun run --cwd packages/opencode test
```
Expected: All tests pass.
