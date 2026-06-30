# Mobile Keyboard Guard — All Text Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent all programmatic `.focus()` calls on text inputs from triggering the mobile keyboard on iOS/Android, so the keyboard only appears when the user explicitly taps a text field.

**Architecture:** Guard every programmatic `.focus()` site with an inline mobile-platform check using `document.documentElement.dataset.platform` (matching the existing precedent in `scroll-view.tsx` line 68). This covers Dialog autofocus, List search autofocus, Select search autofocus, line-comment autofocus, project-picker search focus, session question dock focus, and inline-editor focus. The prompt input (`prompt-input.tsx`), `session.tsx`, and `new-session.tsx` already have guards and are excluded.

**Tech Stack:** SolidJS, TypeScript, Kobalte

---

### Task 1: Guard Dialog v1 autofocus on mobile

**File:** `packages/ui/src/components/dialog.tsx`

The `onOpenAutoFocus` handler queries for `[autofocus]` elements and calls `.focus()`, which triggers the keyboard when a dialog opens on mobile.

- [ ] **Step 1: Add mobile guard to onOpenAutoFocus**

In `packages/ui/src/components/dialog.tsx`, modify the `onOpenAutoFocus` handler (lines 34-41). Replace:

```tsx
onOpenAutoFocus={(e) => {
  const target = e.currentTarget as HTMLElement | null
  const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
  if (autofocusEl) {
    e.preventDefault()
    autofocusEl.focus()
  }
}}
```

With:

```tsx
onOpenAutoFocus={(e) => {
  const target = e.currentTarget as HTMLElement | null
  const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
  if (autofocusEl) {
    e.preventDefault()
    const platform = document.documentElement.dataset.platform
    if (platform !== "ios" && platform !== "android") autofocusEl.focus()
  }
}}
```

This prevents auto-focusing `[autofocus]` elements in dialogs on mobile. Affects all dialog consumers: `dialog-edit-project.tsx`, `dialog-connect-provider.tsx`, `dialog-custom-provider.tsx`, `dialog-select-server.tsx`, `dialog-server-v2.tsx`, `dialog-release-notes.tsx`.

---

### Task 2: Guard Dialog v2 autofocus on mobile

**File:** `packages/ui/src/v2/components/dialog-v2.tsx`

Identical pattern to Dialog v1.

- [ ] **Step 1: Add mobile guard to onOpenAutoFocus**

In `packages/ui/src/v2/components/dialog-v2.tsx`, modify the `onOpenAutoFocus` handler (lines 52-58). Replace:

```tsx
onOpenAutoFocus={(e) => {
  const target = e.currentTarget as HTMLElement | null
  const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
  if (autofocusEl) {
    e.preventDefault()
    autofocusEl.focus()
  }
}}
```

With:

```tsx
onOpenAutoFocus={(e) => {
  const target = e.currentTarget as HTMLElement | null
  const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
  if (autofocusEl) {
    e.preventDefault()
    const platform = document.documentElement.dataset.platform
    if (platform !== "ios" && platform !== "android") autofocusEl.focus()
  }
}}
```

---

### Task 3: Guard List component focus calls on mobile

**File:** `packages/ui/src/components/list.tsx`

Three focus sites: (1) `onPointerDown` on search area focuses the input, (2) `autofocus` attribute passthrough to `TextField`, (3) clear-button refocuses the input. All three trigger the keyboard on mobile.

- [ ] **Step 1: Guard onPointerDown focus on search area**

In `packages/ui/src/components/list.tsx`, modify the `onPointerDown` handler on the search wrapper div (lines 269-279). Replace:

```tsx
onPointerDown={(event) => {
  const container = event.currentTarget
  if (!(container instanceof HTMLElement)) return
  const node = container.querySelector("input, textarea")
  const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node : inputRef
  input?.focus()
  event.stopPropagation()
}}
```

With:

```tsx
onPointerDown={(event) => {
  const container = event.currentTarget
  if (!(container instanceof HTMLElement)) return
  const node = container.querySelector("input, textarea")
  const input = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node : inputRef
  const platform = document.documentElement.dataset.platform
  if (platform !== "ios" && platform !== "android") input?.focus()
  event.stopPropagation()
}}
```

- [ ] **Step 2: Guard autofocus passthrough on TextField**

In the same file, modify the `TextField` autofocus prop (line 286). Replace:

```tsx
autofocus={searchProps().autofocus}
```

With:

```tsx
autofocus={(() => {
  const platform = document.documentElement.dataset.platform
  if (platform === "ios" || platform === "android") return false
  return searchProps().autofocus
})()}
```

- [ ] **Step 3: Guard clear-button refocus**

In the same file, modify the clear button's `onClick` handler (around line 309). Replace:

```tsx
queueMicrotask(() => inputRef?.focus())
```

With:

```tsx
const platform = document.documentElement.dataset.platform
if (platform !== "ios" && platform !== "android") queueMicrotask(() => inputRef?.focus())
```

This guards all three focus sites in the List component. Affects consumers: `dialog-select-model.tsx` (model selector), `dialog-fork.tsx`, `dialog-select-directory.tsx`, `dialog-select-file.tsx`, `dialog-select-mcp.tsx`, `dialog-select-provider.tsx`, `dialog-manage-models.tsx`.

---

### Task 4: Guard Select component autofocus on mobile

**File:** `packages/ui/src/components/select.tsx`

The `onOpenChange` handler auto-focuses the search input when the dropdown opens.

- [ ] **Step 1: Guard search autofocus in onOpenChange**

In `packages/ui/src/components/select.tsx`, modify the `onOpenChange` handler (lines 145-153). Replace:

```tsx
onOpenChange={(open) => {
  local.onOpenChange?.(open)
  if (open && local.search && typeof local.search === "object" && local.search.autofocus) {
    queueMicrotask(() => searchRef?.focus())
  }
  if (!open) { setQuery(""); stop() }
}}
```

With:

```tsx
onOpenChange={(open) => {
  local.onOpenChange?.(open)
  if (open && local.search && typeof local.search === "object" && local.search.autofocus) {
    const platform = document.documentElement.dataset.platform
    if (platform !== "ios" && platform !== "android") queueMicrotask(() => searchRef?.focus())
  }
  if (!open) { setQuery(""); stop() }
}}
```

---

### Task 5: Guard line comment autofocus on mobile (v1 + v2)

**Files:**
- `packages/ui/src/components/line-comment.tsx`
- `packages/ui/src/v2/components/line-comment-v2.tsx`

Both autofocus their textarea on mount unless `autofocus={false}`.

- [ ] **Step 1: Guard line-comment v1 onMount focus**

In `packages/ui/src/components/line-comment.tsx`, modify the `onMount` handler (lines 309-312). Replace:

```tsx
onMount(() => {
  if (split.autofocus === false) return
  requestAnimationFrame(focus)
})
```

With:

```tsx
onMount(() => {
  if (split.autofocus === false) return
  const platform = document.documentElement.dataset.platform
  if (platform === "ios" || platform === "android") return
  requestAnimationFrame(focus)
})
```

- [ ] **Step 2: Guard line-comment v2 onMount focus**

In `packages/ui/src/v2/components/line-comment-v2.tsx`, modify the `onMount` handler (lines 99-101). Replace:

```tsx
onMount(() => {
  if (local.autofocus === false) return
  requestAnimationFrame(() => textareaRef?.focus())
})
```

With:

```tsx
onMount(() => {
  if (local.autofocus === false) return
  const platform = document.documentElement.dataset.platform
  if (platform === "ios" || platform === "android") return
  requestAnimationFrame(() => textareaRef?.focus())
})
```

---

### Task 6: Guard project picker search focus on mobile

**File:** `packages/app/src/components/prompt-input.tsx`

The project picker auto-focuses its search input when opened. The `platform` variable is already available in scope (from `usePlatform()` around line 81).

- [ ] **Step 1: Guard project picker search focus**

In `packages/app/src/components/prompt-input.tsx`, modify the project picker open handler (line 1573). Replace:

```tsx
if (open) requestAnimationFrame(() => projectSearchRef?.focus())
```

With:

```tsx
if (open && platform.platform !== "ios" && platform.platform !== "android") requestAnimationFrame(() => projectSearchRef?.focus())
```

---

### Task 7: Guard session question dock focus on mobile

**File:** `packages/app/src/pages/session/composer/session-question-dock.tsx`

Two focus sites: (1) `focusCustom` auto-focuses the custom-answer textarea on mount via ref callback, (2) `onMouseDown` on the form focuses the textarea when tapping anywhere on the custom answer area.

- [ ] **Step 1: Guard focusCustom ref callback**

In `packages/app/src/pages/session/composer/session-question-dock.tsx`, modify the `focusCustom` function (lines 383-388). Replace:

```tsx
const focusCustom = (el: HTMLTextAreaElement) => {
  setTimeout(() => {
    el.focus()
    resizeInput(el)
  }, 0)
}
```

With:

```tsx
const focusCustom = (el: HTMLTextAreaElement) => {
  setTimeout(() => {
    const platform = document.documentElement.dataset.platform
    if (platform !== "ios" && platform !== "android") el.focus()
    resizeInput(el)
  }, 0)
}
```

- [ ] **Step 2: Guard onMouseDown form focus**

In the same file, modify the `onMouseDown` handler on the custom answer form (lines 527-535). Replace:

```tsx
onMouseDown={(e) => {
  if (sending()) {
    e.preventDefault()
    return
  }
  if (e.target instanceof HTMLTextAreaElement) return
  const input = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
  if (input instanceof HTMLTextAreaElement) input.focus()
}}
```

With:

```tsx
onMouseDown={(e) => {
  if (sending()) {
    e.preventDefault()
    return
  }
  if (e.target instanceof HTMLTextAreaElement) return
  const platform = document.documentElement.dataset.platform
  if (platform === "ios" || platform === "android") return
  const input = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
  if (input instanceof HTMLTextAreaElement) input.focus()
}}
```

---

### Task 8: Guard inline editor focus on mobile

**File:** `packages/app/src/pages/layout/inline-editor.tsx`

The inline editor (for tab renaming) auto-focuses via a ref callback with `requestAnimationFrame(() => el.focus())`.

- [ ] **Step 1: Guard inline editor ref focus**

In `packages/app/src/pages/layout/inline-editor.tsx`, modify the ref callback (around lines 87-95). Find the ref callback that calls `requestAnimationFrame(() => el.focus())` and wrap it:

```tsx
requestAnimationFrame(() => {
  const platform = document.documentElement.dataset.platform
  if (platform === "ios" || platform === "android") return
  el.focus()
})
```

---

### Task 9: Typecheck and commit

- [ ] **Step 1: Run typecheck on UI package**

```bash
cd packages/ui && bun typecheck
```

Expected: PASS with no type errors.

- [ ] **Step 2: Run typecheck on app package**

```bash
cd packages/app && bun typecheck
```

Expected: PASS with no type errors.

- [ ] **Step 3: Commit all changes**

```bash
git add packages/ui/src/components/dialog.tsx \
       packages/ui/src/v2/components/dialog-v2.tsx \
       packages/ui/src/components/list.tsx \
       packages/ui/src/components/select.tsx \
       packages/ui/src/components/line-comment.tsx \
       packages/ui/src/v2/components/line-comment-v2.tsx \
       packages/app/src/components/prompt-input.tsx \
       packages/app/src/pages/session/composer/session-question-dock.tsx \
       packages/app/src/pages/layout/inline-editor.tsx
git commit -m "fix(ui): guard all programmatic text input focus on mobile

Prevent virtual keyboard from appearing on iOS/Android unless the user
explicitly taps a text field. Guards focus calls in Dialog v1/v2 autofocus,
List search autofocus/pointer/clear, Select search autofocus, line-comment
autofocus, project picker search, question dock, and inline editor.

Uses document.documentElement.dataset.platform check (same pattern as
scroll-view.tsx) to detect mobile without importing app-level context."
```

---

## Summary of changes

| # | File | Focus site | Guard type |
|---|------|-----------|------------|
| 1 | `ui/components/dialog.tsx` | `onOpenAutoFocus` → `[autofocus].focus()` | Skip focus on mobile |
| 2 | `ui/v2/components/dialog-v2.tsx` | `onOpenAutoFocus` → `[autofocus].focus()` | Skip focus on mobile |
| 3a | `ui/components/list.tsx` | `onPointerDown` → `input.focus()` | Skip focus on mobile |
| 3b | `ui/components/list.tsx` | `autofocus={searchProps().autofocus}` | Force `false` on mobile |
| 3c | `ui/components/list.tsx` | Clear button → `inputRef.focus()` | Skip focus on mobile |
| 4 | `ui/components/select.tsx` | `onOpenChange` → `searchRef.focus()` | Skip focus on mobile |
| 5a | `ui/components/line-comment.tsx` | `onMount` → `focus()` | Skip focus on mobile |
| 5b | `ui/v2/components/line-comment-v2.tsx` | `onMount` → `textareaRef.focus()` | Skip focus on mobile |
| 6 | `app/components/prompt-input.tsx` | Project picker → `projectSearchRef.focus()` | Skip focus on mobile |
| 7a | `app/pages/.../session-question-dock.tsx` | `focusCustom` ref → `el.focus()` | Skip focus on mobile |
| 7b | `app/pages/.../session-question-dock.tsx` | `onMouseDown` → `input.focus()` | Skip focus on mobile |
| 8 | `app/pages/layout/inline-editor.tsx` | Ref callback → `el.focus()` | Skip focus on mobile |

**Already guarded (no changes needed):**
- `prompt-input.tsx` — `safeFocus()`, `focusEditorEnd()`, `restoreFocus()`, `onMouseDown` wrappers
- `session.tsx` — `handleKeyDown`, `focusInput`, route-change effect
- `new-session.tsx` — `onMount`

**Excluded (not auto-focus, user-initiated only):**
- `home.tsx` search — focus triggered by parent via keybind (not reachable on mobile)
- Android `onboarding.tsx` — no autofocus attributes
- Hidden `<input type="file">` — triggered by `.click()`, not `.focus()`
- Terminal textarea — already has `data-prevent-autofocus` guard

## Self-Review Checklist

- [x] All programmatic `.focus()` calls on text inputs are covered
- [x] Pattern is consistent: inline `document.documentElement.dataset.platform` check (matches `scroll-view.tsx` precedent)
- [x] No new dependencies or files — changes are purely inline guards
- [x] No placeholder patterns (`TBD`, `TODO`, etc.)
- [x] Desktop behavior is completely unchanged
- [x] Direct user taps on mobile text fields still trigger focus/keyboard normally (native behavior)
- [x] Each code block shows exact before/after for the replacement
