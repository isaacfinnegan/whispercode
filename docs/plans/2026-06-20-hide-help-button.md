# Hide Help Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the placeholder help button from the UI to prevent displaying empty/lorem-ipsum content, while retaining the file and layout references to minimize future upstream merge conflicts.

**Architecture:** Modify the `HelpButton` component in `packages/app/src/components/help-button.tsx` to unconditionally return `null`, which disables rendering on all layout rendering paths while preserving the module structure.

**Tech Stack:** SolidJS, TypeScript

---

### Task 1: Modify HelpButton to Return Null

**Files:**
- Modify: `packages/app/src/components/help-button.tsx`

- [ ] **Step 1: Write a test or verify the current state**

Verify typecheck passes before modification:
Run: `bun run typecheck`
Expected: Success

- [ ] **Step 2: Update HelpButton implementation**

Update `packages/app/src/components/help-button.tsx` to return `null` unconditionally:

```tsx
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"

export function HelpButton() {
  return null
}
```

- [ ] **Step 3: Run typecheck to verify it passes**

Run: `bun run typecheck`
Expected: Success

- [ ] **Step 4: Run unit tests to verify codebase health**

Run: `bun run --cwd packages/app test:unit`
Expected: Pass

- [ ] **Step 5: Commit changes**

```bash
rtk git add packages/app/src/components/help-button.tsx
rtk git commit -m "feat(app): hide placeholder help button to prevent empty popover"
```
