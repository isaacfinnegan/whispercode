# Auto-Dismiss Network Error Toasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all network error and session fetching error toast notifications auto-dismiss and are never persistent by intercepting error variant toasts in the central `showToast` wrapper.

**Architecture:** Intercept toasts with `variant: "error"` in the app-level `showToast` utility (`packages/app/src/utils/toast.tsx`). Set `persistent: false` and `duration: options.duration ?? 5000` before forwarding them to `showLegacyToast` or `showToastV2`. This covers all network and database load failures (which use `variant: "error"`) without scattered changes.

**Tech Stack:** SolidJS, Kobalte Toast, Bun Test

---

### Task 1: Create Toast Unit Test File (TDD Failing Test)

**Files:**

- Create: `packages/app/src/utils/toast.test.ts`

- [ ] **Step 1: Write the unit test file containing tests for legacy and V2 error toast duration/persistence overrides**

Create `packages/app/src/utils/toast.test.ts` with the following content:

```typescript
import { beforeAll, describe, expect, mock, test } from "bun:test"
import { showToast, setV2Toast } from "./toast"

const showLegacyToastMock = mock(() => 0)
const showToastV2Mock = mock(() => 0)

beforeAll(() => {
  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: showLegacyToastMock,
  }))

  mock.module("@opencode-ai/ui/v2/toast-v2", () => ({
    ToastV2: { Region: () => null },
    showToastV2: showToastV2Mock,
  }))
})

describe("toast wrapper utility", () => {
  test("legacy toast: general options passed through", () => {
    setV2Toast(false)
    showToast({ title: "hello", variant: "success" })
    expect(showLegacyToastMock).toHaveBeenCalledWith({ title: "hello", variant: "success" })
  })

  test("legacy toast: error variant forces auto-dismiss (persistent: false, duration: 5000)", () => {
    setV2Toast(false)
    showToast({ title: "error occurred", variant: "error" })
    expect(showLegacyToastMock).toHaveBeenCalledWith({
      title: "error occurred",
      variant: "error",
      persistent: false,
      duration: 5000,
    })
  })

  test("v2 toast: general options passed through", () => {
    setV2Toast(true)
    showToast({ title: "hello", variant: "success" })
    expect(showToastV2Mock).toHaveBeenCalled()
  })

  test("v2 toast: error variant forces auto-dismiss (persistent: false, duration: 5000)", () => {
    setV2Toast(true)
    showToast({ title: "error occurred", variant: "error" })
    const lastCall = showToastV2Mock.mock.calls[showToastV2Mock.mock.calls.length - 1]
    expect(lastCall[0]).toMatchObject({
      title: "error occurred",
      variant: "error",
      persistent: false,
      duration: 5000,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PATH="/Users/isaac/.bun/bin:$PATH" bun test --preload ./happydom.ts ./src/utils/toast.test.ts`
Expected: FAIL on error variant tests (since `persistent: false` and `duration: 5000` are not yet set by `showToast`).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/utils/toast.test.ts
git commit -m "test: add failing toast wrapper unit tests for auto-dismiss errors"
```

---

### Task 2: Implement Auto-Dismiss Behavior in `showToast`

**Files:**

- Modify: `packages/app/src/utils/toast.tsx`

- [ ] **Step 1: Update `showToast` implementation to intercept `variant: "error"` and override persistent/duration**

Modify `packages/app/src/utils/toast.tsx`:

```tsx
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Toast, showToast as showLegacyToast, type ToastOptions, type ToastVariant } from "@opencode-ai/ui/toast"
import { ToastV2, showToastV2 } from "@opencode-ai/ui/v2/toast-v2"

let v2 = false

export function setV2Toast(value: boolean) {
  v2 = value
}

export function ToastRegion(props: { v2: boolean }) {
  if (props.v2) return <ToastV2.Region />
  return <Toast.Region />
}

export function showToast(options: ToastOptions | string) {
  if (!v2) {
    if (typeof options !== "string" && options.variant === "error") {
      return showLegacyToast({
        ...options,
        persistent: false,
        duration: options.duration ?? 5000,
      })
    }
    return showLegacyToast(options)
  }
  if (typeof options === "string") return showToastV2(options)

  const isError = options.variant === "error"
  const duration = isError ? (options.duration ?? 5000) : options.duration
  const persistent = isError ? false : options.persistent

  return showToastV2({
    ...options,
    duration,
    persistent,
    icon: resolveIcon(options.icon, options.variant),
    actions: options.actions?.map((action) => ({
      ...action,
      variant: action.onClick === "dismiss" ? "secondary" : "primary",
    })),
  })
}

function resolveIcon(icon: IconProps["name"] | undefined, variant: ToastVariant | undefined) {
  const name = icon ?? (variant === "success" ? "check" : undefined)
  if (!name) return
  return <Icon name={name} />
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `PATH="/Users/isaac/.bun/bin:$PATH" bun test --preload ./happydom.ts ./src/utils/toast.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/utils/toast.tsx
git commit -m "feat: intercept error variant toasts in showToast to force auto-dismiss"
```

---

### Task 3: Full Workspace Verification

**Files:**

- None (verification stage)

- [ ] **Step 1: Run full unit test suite in `packages/app`**

Run: `PATH="/Users/isaac/.bun/bin:$PATH" bun run --cwd packages/app test:unit`
Expected: All 600+ tests pass.

- [ ] **Step 2: Run type check in `packages/app`**

Run: `PATH="/Users/isaac/.bun/bin:$PATH" bun run --cwd packages/app typecheck`
Expected: Exit code 0, no compilation/type errors.

- [ ] **Step 3: Commit all remaining verification artifacts**

```bash
git commit --allow-empty -m "chore: verify tests and typecheck pass successfully"
```
