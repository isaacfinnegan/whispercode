# Mobile Keyboard Focus Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent programmatic auto-focusing of the prompt input bar on mobile devices (iOS/Android) so the soft keyboard only triggers when the user explicitly taps the text field.

**Architecture:** We will guard all remaining programmatic `.focus()` calls on the prompt input field (`editorRef`/`inputRef`) with a check for mobile platforms (`platform.platform === "ios" || platform.platform === "android"`). These calls are located in route changes, page mounts, keydown handlers, and container click/mouseDown events. Since the contenteditable element natively handles focus on direct taps, this change ensures that the soft keyboard is only triggered by direct user interaction on the text field itself.

**Tech Stack:** SolidJS, TypeScript

---

### Task 1: Update New Session Page Mount Guard

**Files:**
- Modify: `packages/app/src/pages/new-session.tsx`

- [ ] **Step 1: Import platform context and retrieve platform object**

Modify imports in `packages/app/src/pages/new-session.tsx` to include `usePlatform`:
```typescript
import { usePlatform } from "@/context/platform"
```
And instantiate it inside `NewSessionPage`:
```typescript
export default function NewSessionPage() {
  const platform = usePlatform()
  const prompt = usePrompt()
```

- [ ] **Step 2: Add isMobile check to onMount focus callback**

Modify the `onMount` handler around line 48 to only execute focus programmatically when not on mobile:
```typescript
  onMount(() => {
    const isMobile = platform.platform === "ios" || platform.platform === "android"
    if (!isMobile) {
      requestAnimationFrame(() => inputRef?.focus())
    }
  })
```

- [ ] **Step 3: Run typecheck to verify changes**

Run: `npm run typecheck` in `packages/app`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/pages/new-session.tsx
git commit -m "feat(app): guard draft session mount auto-focus on mobile"
```

---

### Task 2: Update Session Page Focus Calls

**Files:**
- Modify: `packages/app/src/pages/session.tsx`

- [ ] **Step 1: Guard global keydown handler programmatic focus**

Modify the keydown listener around line 854:
```typescript
    if (event.key.length === 1 && event.key !== "Unidentified" && !(event.ctrlKey || event.metaKey)) {
      if (composer.blocked() || isChildSession()) return
      const isMobile = platform.platform === "ios" || platform.platform === "android"
      if (!isMobile) {
        inputRef?.focus()
      }
    }
```

- [ ] **Step 2: Guard focusInput helper**

Modify the `focusInput` function around line 907:
```typescript
  const focusInput = () => {
    if (isChildSession()) return
    const isMobile = platform.platform === "ios" || platform.platform === "android"
    if (isMobile && document.activeElement !== inputRef) return
    inputRef?.focus()
  }
```

- [ ] **Step 3: Guard route change auto-focus**

Modify the `createEffect` tracking `params.id` around line 1639:
```typescript
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) {
          const isMobile = platform.platform === "ios" || platform.platform === "android"
          if (!isMobile) {
            requestAnimationFrame(() => inputRef?.focus())
          }
        }
      },
    ),
  )
```

- [ ] **Step 4: Run typecheck to verify changes**

Run: `npm run typecheck` in `packages/app`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/pages/session.tsx
git commit -m "feat(app): guard session keydown, routing, and command focus on mobile"
```

---

### Task 3: Update Prompt Input Wrapper Event Handlers

**Files:**
- Modify: `packages/app/src/components/prompt-input.tsx`

- [ ] **Step 1: Guard normal layout prompt-input wrapper onMouseDown**

Modify the outer wrapper's `onMouseDown` handler around line 1658:
```typescript
              <div
                class="relative min-h-[52px]"
                onMouseDown={(e) => {
                  const target = e.target
                  if (!(target instanceof HTMLElement)) return
                  if (target.closest('[data-action^="prompt-"]')) return
                  const isMobile = platform.platform === "ios" || platform.platform === "android"
                  if (!isMobile) {
                    editorRef?.focus()
                  }
                }}
              >
```

- [ ] **Step 2: Guard alternative layout prompt-input wrapper onMouseDown**

Modify the other wrapper's `onMouseDown` handler around line 1840:
```typescript
            <div
              class="relative"
              onMouseDown={(e) => {
                const target = e.target
                if (!(target instanceof HTMLElement)) return
                if (target.closest('[data-action="prompt-attach"], [data-action="prompt-submit"]')) {
                  return
                }
                const isMobile = platform.platform === "ios" || platform.platform === "android"
                if (!isMobile) {
                  editorRef?.focus()
                }
              }}
            >
```

- [ ] **Step 3: Run typecheck to verify changes**

Run: `npm run typecheck` in `packages/app`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/components/prompt-input.tsx
git commit -m "feat(app): guard prompt input wrapper mouse down focus on mobile"
```

---

## Self-Review Checklist

- [ ] Verify that all 6 identified `.focus()` calls have a check for `platform.platform === "ios" || platform.platform === "android"`.
- [ ] Verify that no `TBD`, `TODO`, or placeholder patterns are used.
- [ ] Verify code changes compile successfully with `npm run typecheck` in `packages/app`.
