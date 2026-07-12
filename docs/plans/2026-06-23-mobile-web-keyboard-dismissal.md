# Mobile Web Keyboard Dismissal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure mobile web browsers trigger mobile-specific focus/blur behaviors, particularly keyboard dismissal when a prompt is sent, by adopting the `isMobilePlatform` helper repo-wide.

**Architecture:** Use `isMobilePlatform(platform)` instead of the native-only `platform.platform === "ios" || platform.platform === "android"` checks in session pages and prompt-input components. This allows mobile web browsers to also blur the input and focus the scroller window on submit.

**Tech Stack:** SolidJS, TypeScript, Bun

---

### Task 1: Update session.tsx to use isMobilePlatform

**Files:**

- Modify: `packages/app/src/pages/session.tsx`

- [ ] **Step 1: Import isMobilePlatform**

Import `isMobilePlatform` from `../components/terminal` (or using `@/components/terminal`) in `packages/app/src/pages/session.tsx`.

- [ ] **Step 2: Update mobilePlatform helper and inline checks**

Update the `mobilePlatform` helper definition and other inline checks from `platform.platform === "ios" || platform.platform === "android"` to `isMobilePlatform(platform)`.

- [ ] **Step 3: Run the app typecheck to verify**

Run typecheck: `bun run --cwd packages/app typecheck`

### Task 2: Update prompt-input.tsx to use isMobilePlatform

**Files:**

- Modify: `packages/app/src/components/prompt-input.tsx`

- [ ] **Step 1: Import isMobilePlatform**

Import `isMobilePlatform` from `./terminal`.

- [ ] **Step 2: Update inline isMobile checks**

Replace `platform.platform === "ios" || platform.platform === "android"` checks with `isMobilePlatform(platform)`.

- [ ] **Step 3: Run the app typecheck to verify**

Run typecheck: `bun run --cwd packages/app typecheck`

### Task 3: Update submit.ts to use isMobilePlatform

**Files:**

- Modify: `packages/app/src/components/prompt-input/submit.ts`

- [ ] **Step 1: Import isMobilePlatform**

Import `isMobilePlatform` from `../terminal`.

- [ ] **Step 2: Update isMobile check**

Replace the check in `restoreInput` with `isMobilePlatform(platform)`.

- [ ] **Step 3: Run the app unit tests to verify**

Run tests: `bun run --cwd packages/app test:unit`
Expected: All tests pass.
