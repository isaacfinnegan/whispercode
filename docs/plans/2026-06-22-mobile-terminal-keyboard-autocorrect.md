# Mobile Terminal Keyboard Autocorrect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve keyboard autocorrect/spelling and composition buffering issues in the web terminal when accessed from a mobile browser.

**Architecture:** Export an `isMobilePlatform` helper function that evaluates user agent strings for iOS/Android when platform is "web". Replace inline platform checks in the terminal components and touch event handlers with this helper, ensuring proper terminal overlay styling and typing attribute settings are correctly applied on mobile web. Add unit tests for the helper function.

**Tech Stack:** SolidJS, Bun, ghostty-web.

---

### Task 1: Write failing unit tests for `isMobilePlatform`

**Files:**
- Modify: `packages/app/src/components/terminal-touch.test.ts`

- [ ] **Step 1: Write the failing tests**

Modify `packages/app/src/components/terminal-touch.test.ts` to import `afterEach` and `isMobilePlatform`, and add the new test cases:

```typescript
import { afterEach, describe, expect, test } from "bun:test"
import { isMobilePlatform, terminalTouchScrollAmount } from "./terminal"

describe("terminalTouchScrollAmount", () => {
  test("maps a downward drag to upward terminal scrollback", () => {
    expect(terminalTouchScrollAmount({ deltaY: 32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })

  test("maps an upward drag back toward the terminal bottom", () => {
    expect(terminalTouchScrollAmount({ deltaY: -32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: 2,
      remainder: 0,
    })
  })

  test("accumulates sub-line touch movement", () => {
    const first = terminalTouchScrollAmount({ deltaY: 6, lineHeight: 16, remainder: 0 })
    expect(first).toEqual({
      amount: 0,
      remainder: 0.375,
    })

    expect(terminalTouchScrollAmount({ deltaY: 11, lineHeight: 16, remainder: first.remainder })).toEqual({
      amount: -1,
      remainder: 0.0625,
    })
  })

  test("uses a minimum line height for tiny measurements", () => {
    expect(terminalTouchScrollAmount({ deltaY: 16, lineHeight: 0, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })
})

describe("isMobilePlatform", () => {
  const originalUserAgent = globalThis.navigator?.userAgent

  afterEach(() => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })

  test("returns true for iOS platform", () => {
    expect(isMobilePlatform({ platform: "ios" } as any)).toBe(true)
  })

  test("returns true for Android platform", () => {
    expect(isMobilePlatform({ platform: "android" } as any)).toBe(true)
  })

  test("returns false for web platform with desktop user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(false)
  })

  test("returns true for web platform with iOS user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(true)
  })

  test("returns true for web platform with Android user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun test --preload ./happydom.ts ./src/components/terminal-touch.test.ts`
Expected: FAIL with "isMobilePlatform is not defined" or similar export compilation error.

- [ ] **Step 3: Commit initial test additions**

```bash
git add packages/app/src/components/terminal-touch.test.ts
git commit -m "test: add unit tests for isMobilePlatform check"
```

---

### Task 2: Implement `isMobilePlatform` helper and update components

**Files:**
- Modify: `packages/app/src/components/terminal.tsx`

- [ ] **Step 1: Implement `isMobilePlatform`**

Add the helper definition near line 98, right before `useTerminalUiBindings`:

```typescript
export const isMobilePlatform = (platform: Platform) => {
  return (
    platform.platform === "ios" ||
    platform.platform === "android" ||
    (platform.platform === "web" &&
      typeof navigator === "object" &&
      typeof navigator.userAgent === "string" &&
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))
  )
}
```

- [ ] **Step 2: Update `useTerminalUiBindings` to use the helper**

Replace line 106 (inside `useTerminalUiBindings`):

```typescript
  const isMobile = input.platform.platform === "ios" || input.platform.platform === "android"
```

With:

```typescript
  const isMobile = isMobilePlatform(input.platform)
```

- [ ] **Step 3: Update `Terminal` component to use the helper**

Replace line 492 (inside `Terminal`'s `onMount`):

```typescript
      const isMobile = platform.platform === "ios" || platform.platform === "android"
```

With:

```typescript
      const isMobile = isMobilePlatform(platform)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun test --preload ./happydom.ts ./src/components/terminal-touch.test.ts`
Expected: PASS (9 tests pass across 1 file).

- [ ] **Step 5: Commit changes**

```bash
git add packages/app/src/components/terminal.tsx
git commit -m "fix(terminal): detect mobile browser environment to apply styling and input attributes"
```

---

### Task 3: Comprehensive verification

**Files:**
- Verify: Entire app test suite

- [ ] **Step 1: Run full unit test suite**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && bun run test:unit`
Expected: All tests pass without regression.
