# Mobile Menu Auto-Focus Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely prevent Kobalte's default auto-focus behavior inside all popovers, dropdown select menus, and dialogs when opened on mobile (iOS/Android) platforms, so that the virtual keyboard is never triggered unless the user explicitly taps a text field.

**Architecture:** Intercept `onOpenAutoFocus` on `Kobalte.Content` (for Popovers, Select menus, and Dialogs) and call `event.preventDefault()` when the platform is iOS or Android (detected via `document.documentElement.dataset.platform`). This ensures that Kobalte's built-in focus-trapping behavior does not programmatically focus the first interactive/focusable child element when the container opens.

**Tech Stack:** SolidJS, TypeScript, Kobalte

---

### Task 1: Complete autofocus prevention on mobile in Dialog v1

**File:** `/Users/isaac/Projects/whispercode/packages/ui/src/components/dialog.tsx`

The `onOpenAutoFocus` handler currently only prevents default if an `[autofocus]` element is queryable. If there's no `[autofocus]` element, Kobalte falls back to focusing the first focusable element. On mobile, we want to completely skip focusing anything.

- [ ] **Step 1: Update onOpenAutoFocus in Dialog v1**

Modify `onOpenAutoFocus` in `packages/ui/src/components/dialog.tsx` (lines 34-44):

Replace:
```tsx
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              const platform = document.documentElement.dataset.platform
              if (platform !== "ios" && platform !== "android") {
                autofocusEl.focus()
              }
            }
          }}
```

With:
```tsx
          onOpenAutoFocus={(e) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              e.preventDefault()
              return
            }
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
```

---

### Task 2: Complete autofocus prevention on mobile in Dialog v2

**File:** `/Users/isaac/Projects/whispercode/packages/ui/src/v2/components/dialog-v2.tsx`

Same change as Dialog v1.

- [ ] **Step 1: Update onOpenAutoFocus in Dialog v2**

Modify `onOpenAutoFocus` in `packages/ui/src/v2/components/dialog-v2.tsx` (lines 52-62):

Replace:
```tsx
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              const platform = document.documentElement.dataset.platform
              if (platform !== "ios" && platform !== "android") {
                autofocusEl.focus()
              }
            }
          }}
```

With:
```tsx
          onOpenAutoFocus={(e) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              e.preventDefault()
              return
            }
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
```

---

### Task 3: Prevent Kobalte autofocus on mobile in Select component

**File:** `/Users/isaac/Projects/whispercode/packages/ui/src/components/select.tsx`

We need to add `onOpenAutoFocus` on `<Kobalte.Content>` to prevent Kobalte from focusing the nested search input element on mobile when the dropdown opens.

- [ ] **Step 1: Add onOpenAutoFocus on Select content**

Modify `<Kobalte.Content>` in `packages/ui/src/components/select.tsx` (around line 185):

Replace:
```tsx
        <Kobalte.Content
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
          data-trigger-style={local.triggerVariant}
        >
```

With:
```tsx
        <Kobalte.Content
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
          data-component="select-content"
          data-trigger-style={local.triggerVariant}
          onOpenAutoFocus={(event) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              event.preventDefault()
            }
          }}
        >
```

---

### Task 4: Prevent Kobalte autofocus on mobile in SelectV2 component

**File:** `/Users/isaac/Projects/whispercode/packages/ui/src/v2/components/select-v2.tsx`

Same change for SelectV2 dropdown container.

- [ ] **Step 1: Add onOpenAutoFocus on SelectV2 content**

Modify `<Kobalte.Content>` in `packages/ui/src/v2/components/select-v2.tsx` (around line 202):

Replace:
```tsx
        <Kobalte.Content data-component="menu-v2-content" data-slot="select-v2-content">
```

With:
```tsx
        <Kobalte.Content
          data-component="menu-v2-content"
          data-slot="select-v2-content"
          onOpenAutoFocus={(event) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              event.preventDefault()
            }
          }}
        >
```

---

### Task 5: Prevent Kobalte autofocus on mobile in Model Selector Popover

**File:** `/Users/isaac/Projects/whispercode/packages/app/src/components/dialog-select-model.tsx`

The popover has no `onOpenAutoFocus` handler on its `<Kobalte.Content>`, meaning Kobalte's default behavior automatically focuses the nested list search input.

- [ ] **Step 1: Add onOpenAutoFocus to ModelSelectorPopover content**

Modify `<Kobalte.Content>` in `packages/app/src/components/dialog-select-model.tsx` (around line 143):

Replace:
```tsx
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onEscapeKeyDown={(event) => {
```

With:
```tsx
      <Kobalte.Portal>
        <Kobalte.Content
          class="w-72 h-80 flex flex-col p-2 rounded-md border border-border-base bg-surface-raised-stronger-non-alpha shadow-md z-50 outline-none overflow-hidden"
          onOpenAutoFocus={(event) => {
            const platform = document.documentElement.dataset.platform
            if (platform === "ios" || platform === "android") {
              event.preventDefault()
            }
          }}
          onEscapeKeyDown={(event) => {
```

---

### Task 6: Prevent Kobalte autofocus on mobile in Reusable Popover

**File:** `/Users/isaac/Projects/whispercode/packages/ui/src/components/popover.tsx`

Ensure the shared UI `Popover` component also prevents mobile autofocus.

- [ ] **Step 1: Add onOpenAutoFocus to shared Popover content**

Modify `<Kobalte.Content>` in `packages/ui/src/components/popover.tsx` (around line 105):

Replace:
```tsx
  const content = () => (
    <Kobalte.Content
      ref={(el: HTMLElement | undefined) => setState("contentRef", el)}
      data-component="popover-content"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={local.style}
      onCloseAutoFocus={(event: Event) => {
```

With:
```tsx
  const content = () => (
    <Kobalte.Content
      ref={(el: HTMLElement | undefined) => setState("contentRef", el)}
      data-component="popover-content"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      style={local.style}
      onOpenAutoFocus={(event) => {
        const platform = document.documentElement.dataset.platform
        if (platform === "ios" || platform === "android") {
          event.preventDefault()
        }
      }}
      onCloseAutoFocus={(event: Event) => {
```

---

### Task 7: Prevent Kobalte autofocus on mobile in Share Popover

**File:** `/Users/isaac/Projects/whispercode/packages/app/src/pages/session/message-timeline.tsx`

Ensure the share session popover does not focus the readonly copyable url on mobile opening.

- [ ] **Step 1: Add onOpenAutoFocus to Share Popover content**

Modify `<KobaltePopover.Content>` in `packages/app/src/pages/session/message-timeline.tsx` (around line 1492):

Replace:
```tsx
                        <KobaltePopover.Portal>
                          <KobaltePopover.Content
                            data-component="popover-content"
                            style={{ "min-width": "320px" }}
                            onEscapeKeyDown={(event) => {
```

With:
```tsx
                        <KobaltePopover.Portal>
                          <KobaltePopover.Content
                            data-component="popover-content"
                            style={{ "min-width": "320px" }}
                            onOpenAutoFocus={(event) => {
                              const platform = document.documentElement.dataset.platform
                              if (platform === "ios" || platform === "android") {
                                event.preventDefault()
                              }
                            }}
                            onEscapeKeyDown={(event) => {
```

---

### Task 8: Verification

- [ ] **Step 1: Run typechecks**

Run `bun typecheck` in both UI and App directories to ensure there are no compilation issues.

```bash
# Verify UI package
cd packages/ui && bun typecheck

# Verify App package
cd packages/app && bun typecheck
```

---

## Self-Review Checklist

- [x] All dialog and popover autofocus paths on mobile are intercepted.
- [x] The model selection popover search focus issue is targeted directly.
- [x] No placeholders like TBD or TODO remain.
- [x] Checks are consistent with previous mobile platform guard implementations.
