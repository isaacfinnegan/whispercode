# Upstream Merge July 2026 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge 35 commits from `upstream/dev` into the current `dev` branch while preserving WhisperCode-specific mobile fork features, dependencies, and settings.

**Architecture:** We will create a local branch named `dev-merge-upstream-july`, execute the git merge command, resolve all identified conflicts (specifically preserving mobile wrappers, pinned dependency versions, and custom SolidJS/Tauri bridge code), regenerate the SDK/API surface, rebuild the CLI, and run the test suites to ensure parity.

**Tech Stack:** Git, Bun, TypeScript, Rust/Tauri

---

### Task 1: Create merge branch and run git merge

**Files:**

- Create branch: `dev-merge-upstream-july`

- [ ] **Step 1: Check out a new branch to isolate the merge**

Run: `git checkout -b dev-merge-upstream-july`
Expected: Switched to a new branch 'dev-merge-upstream-july'

- [ ] **Step 2: Pull latest commits from upstream/dev to ensure we are up to date**

Run: `git fetch upstream dev`
Expected: Fetch complete

- [ ] **Step 3: Run git merge command to initiate the merge**

Run: `git merge upstream/dev --no-commit --no-ff`
Expected: Merge starts with conflicts listed in bun.lock, packages/app/package.json, packages/app/src/components/help-button.tsx, packages/app/src/components/prompt-input.tsx, packages/app/src/components/prompt-input/submit.ts, packages/app/src/components/terminal.tsx, packages/app/src/components/titlebar.tsx, packages/app/src/env.d.ts, packages/app/src/pages/layout-new.tsx, packages/app/src/pages/layout.tsx, packages/app/src/pages/new-session.tsx, packages/app/src/pages/session.tsx, packages/app/src/pages/session/timeline/message-timeline.tsx, packages/app/src/utils/persist.ts, packages/ui/src/components/tabs.css

- [ ] **Step 4: Commit branch state (with conflicts marked in working copy)**

We keep the merge in a conflicted state while we resolve file-by-file in the next tasks.

---

### Task 2: Resolve conflicts in package/dependency files and environment typings

**Files:**

- Modify: `packages/app/package.json`
- Modify: `packages/app/src/env.d.ts`
- Modify: `bun.lock`

- [ ] **Step 1: Resolve packages/app/package.json conflicts**

Ensure that:

1. Version is set to `"1.17.18"`.
2. `"ghostty-web"` dependency is pinned exactly to `"github:anomalyco/ghostty-web#20bd361"`.
3. `@corvu/drawer` dependency is added as `"catalog:"`.

Replace:

```json
<<<<<<< HEAD
    "ghostty-web": "github:anomalyco/ghostty-web#20bd361",
=======
    "@corvu/drawer": "catalog:",
    "ghostty-web": "github:anomalyco/ghostty-web#513463a6f1190253057e8a3f0dac8f6ee8393553",
>>>>>>> upstream/dev
```

With:

```json
    "@corvu/drawer": "catalog:",
    "ghostty-web": "github:anomalyco/ghostty-web#20bd361",
```

- [ ] **Step 2: Resolve packages/app/src/env.d.ts conflicts**

Combine WhisperCode push notification environment variables with upstream png/mp4 asset typings:

Replace:

```typescript
<<<<<<< HEAD
  readonly VITE_WHISPEROPENCODE_PUSH_SPEC: string
  readonly VITE_WHISPEROPENCODE_PUSH_PLUGIN: string
}
=======
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}
>>>>>>> upstream/dev
```

With:

```typescript
  readonly VITE_WHISPEROPENCODE_PUSH_SPEC: string
  readonly VITE_WHISPEROPENCODE_PUSH_PLUGIN: string
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}
```

- [ ] **Step 3: Regenerate lockfile to resolve conflicts**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun install`
Expected: bun.lock conflict is resolved and packages are successfully installed.

- [ ] **Step 4: Verify build files can compile**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run typecheck`
Expected: Verification script runs without error or shows only source-level conflicts to resolve next.

---

### Task 3: Resolve conflicts in SolidJS components

**Files:**

- Modify: `packages/app/src/components/help-button.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/terminal.tsx`
- Modify: `packages/app/src/components/titlebar.tsx`

- [ ] **Step 1: Resolve help-button.tsx conflict**

Keep `HelpButton` returning `null` to avoid showing the help popover in the mobile fork. Additionally, stub out `TabsInfoPopup` to `return null` so that it doesn't render on mobile viewports.

Replace:

```tsx
<<<<<<< HEAD
export function HelpButton() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  return null
}
=======
// ... [Upstream rewritten HelpButton and TabsInfoPopup implementation] ...
>>>>>>> upstream/dev
```

With:

```tsx
export function HelpButton() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  return null
}

export function TabsInfoPopup() {
  if (import.meta.env.VITE_OPENCODE_CHANNEL !== "dev") return null

  return null
}
```

- [ ] **Step 2: Resolve prompt-input.tsx conflicts**

Merge the V2 component usage (`IconButtonV2`, `IconV2`) and model selection parameters while preserving the mobile voice swiping gestures, keyboard autofocus checks, and speech-to-text transcription event handlers.

For imports:
Ensure both `Icon` and `IconV2`/`IconButtonV2` are imported as needed.

For `usePrompt` instantiation:
Replace:

```tsx
<<<<<<< HEAD
  const prompt = usePrompt()
=======
  const prompt = usePrompt({
    model: props.controls.model.selection,
  })
>>>>>>> upstream/dev
```

With:

```tsx
const prompt = usePrompt({
  model: props.controls.model.selection,
})
```

For mobile input check:
Ensure `safeFocus` check wrapping editor focus triggers is preserved.

For action button:
Ensure the voice microphone button and tooltips are preserved under:

```tsx
<Show when={store.mode === "normal" && isMobilePlatform(platform) && platform.startVoiceInput}>
```

- [ ] **Step 3: Resolve prompt-input/submit.ts conflicts**

Combine the focus suppression wrapper check with the model parameter promotion updates.

Replace:

```typescript
<<<<<<< HEAD
        editor.focus()
=======
        const isMobile = isMobilePlatform(platform)
        if (!(isMobile && document.activeElement !== editor)) {
          editor.focus()
        }
>>>>>>> upstream/dev
```

(Ensure the mobile platform check is preserved).

Ensure that:

```typescript
const modelSelection = input.model ?? local.model
const currentModel = modelSelection.current()
```

is merged alongside the updated session promotion parameters wrapping `local.session.promote`.

- [ ] **Step 4: Resolve terminal.tsx conflicts**

Ensure that we combine our mobile terminal touch scroll translations and autocomplete disable parameters with the new V2 background themes loader.

Ensure:

```typescript
const isMobile = isMobilePlatform(input.platform)
```

and `handleTouchStart`/`handleTouchMove` events are registered.

Ensure background color selection resolves V2 tokens if `newLayoutDesigns` setting is true:

```typescript
const background = settings.general.newLayoutDesigns()
  ? (resolveV2Token(resolveThemeVariantV2(variant, mode === "dark"), "v2-background-bg-base") ?? fallback.background)
  : (resolved["background-stronger"] ?? fallback.background)
```

- [ ] **Step 5: Resolve titlebar.tsx conflicts**

Keep our `TitlebarUpdateIconButton` returning `null` stub, and incorporate the changes that pass `model` parameters to `tabs.newDraft`.

Ensure:

```tsx
function TitlebarUpdateIconButton(props: { state: TitlebarUpdatePillState }) {
  return null
}
```

And ensure new draft actions look up active models before calling `newDraft`:

```typescript
const model = tabs.stateValue<PromptSession>(sessionTab, "prompt")?.model.current()
tabs.newDraft({ server: sessionTab.server, directory: activeSession.directory }, "", model)
```

- [ ] **Step 6: Verify packages/app typechecks**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run typecheck`
Expected: PASS

---

### Task 4: Resolve conflicts in layout, session page, and timeline

**Files:**

- Modify: `packages/app/src/pages/layout-new.tsx`
- Modify: `packages/app/src/pages/layout.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/timeline/message-timeline.tsx`

- [ ] **Step 1: Resolve layout-new.tsx conflicts**

Remove inline safe-area styling from `NewLayout` and render `<TabsInfoPopup />` (stubbed to return `null`).

- [ ] **Step 2: Resolve layout.tsx conflicts**

Ensure we render `<TabsInfoPopup />` at the bottom of the legacy layout, and preserve the deep linking hooks, push preference synchronization handlers, and notification routing setup in `onMount`.

- [ ] **Step 3: Resolve new-session.tsx conflicts**

Keep the platform-based autofocus check inside the `onMount` block:

```typescript
const isMobile = platform.platform === "ios" || platform.platform === "android"
if (!isMobile) {
  requestAnimationFrame(() => inputRef?.focus())
}
```

And register the `"new-session"` keyboard focus command from upstream.

- [ ] **Step 4: Resolve session.tsx conflicts**

Adopt the new model synchronization effects:

```typescript
let restoredModelSession: string | undefined
createEffect(() => {
  const id = params.id
  if (!id || !prompt.ready() || !local.session.ready()) return
  if (restoredModelSession !== id) {
    restoredModelSession = id
    if (restorePromptModel(local, prompt)) return
  }
  syncPromptModel(local, prompt)
})
```

And ensure that:

1. `bg-v2-background-bg-base` is used for the container background.
2. Background sync (`onResume`/`onVisibility`), file-review limits (`activeReviewLimit`), custom scrolling details, and mobile-focus gating are preserved.

- [ ] **Step 5: Resolve message-timeline.tsx conflicts**

Retain the `"overscroll-behavior-y": "contain"` style on the scroller div and the `measure` existence check on the virtualizer. Merge the padding adjustments (`pl-2.5`) and overflow margins.

- [ ] **Step 6: Verify compile and check types**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run typecheck`
Expected: PASS

---

### Task 5: Resolve persist.ts and tabs.css conflicts

**Files:**

- Modify: `packages/app/src/utils/persist.ts`
- Modify: `packages/ui/src/components/tabs.css`

- [ ] **Step 1: Resolve persist.ts conflicts**

Keep our `useAsync` check to ensure the mobile Tauri/WebView wrappers use the native async storage bridge:

```typescript
const useAsync = platform?.platform !== "web" && !!platform?.storage
```

And remove `"model-selection"` from `DRAFT_PERSISTED_KEYS`.

- [ ] **Step 2: Resolve tabs.css conflicts**

Combine the mobile styling media queries (gated under `@media (max-width: 639px)`) with the upstream horizontal tab colors/gradients.

- [ ] **Step 3: Run full typecheck**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run typecheck`
Expected: PASS

---

### Task 6: Finalize merge, regenerate, build, and test

**Files:**

- Modify: None (build artifacts only)

- [ ] **Step 1: Run code generation script**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run ./script/generate.ts`
Expected: SDK and API routes regenerated successfully.

- [ ] **Step 2: Regenerate JS SDK**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run --cwd packages/sdk/js build`
Expected: SDK rebuilds successfully.

- [ ] **Step 3: Rebuild the CLI**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run --cwd packages/opencode build`
Expected: CLI build succeeds.

- [ ] **Step 4: Run full packages/app unit tests**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && rtk bun run --cwd packages/app test:unit`
Expected: PASS with 0 failures

- [ ] **Step 5: Run full packages/opencode unit tests**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && rtk bun run --cwd packages/opencode test`
Expected: PASS

- [ ] **Step 6: Sync Android version**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run script/sync-android-version.ts`
Expected: Android package version synced with workspace version.

- [ ] **Step 7: Commit the merge**

Run: `git commit -m "merge: sync with upstream/dev up to 05ca70077"`
Expected: Commit succeeds

- [ ] **Step 8: Push branch and create PR**

Run: `git push -u origin dev-merge-upstream-july`
Expected: Push succeeds and outputs branch URL.
