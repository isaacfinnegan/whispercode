# Fix Jump to Bottom Button Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the regression where the "jump to bottom" arrow button is permanently displayed in the chat timeline by aligning the scroll calculations with the non-reversed timeline scroll behavior.

**Architecture:** The desktop chat timeline has transitioned from a column-reversed scroll container to a standard scroll container. The `distanceFromScrollBottom` helper in `session.tsx` must be updated to calculate distance as `scrollHeight - clientHeight - scrollTop` on all platforms, discarding the legacy reversed scroll check that returned `Math.abs(el.scrollTop)` on desktop.

**Tech Stack:** SolidJS, TypeScript.

---

### Task 1: Update distanceFromScrollBottom in session.tsx

**Files:**
- Modify: `packages/app/src/pages/session.tsx:1195-1203`

- [ ] **Step 1: Verify typecheck baseline**

Run: `bun run typecheck`
Expected: SUCCESS

- [ ] **Step 2: Update distanceFromScrollBottom calculation**

Modify `packages/app/src/pages/session.tsx` to compute the scroll bottom offset uniformly across all platforms:
```typescript
  const distanceFromScrollBottom = (el: HTMLDivElement) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    return Math.max(0, max - el.scrollTop)
  }
```

- [ ] **Step 3: Run typescript check to verify changes**

Run: `bun run typecheck`
Expected: SUCCESS

- [ ] **Step 4: Run unit tests to confirm timeline state behaves correctly**

Run: `bun run --cwd packages/app test:unit`
Expected: SUCCESS (all 490 tests pass)

- [ ] **Step 5: Commit changes**

```bash
rtk git add packages/app/src/pages/session.tsx
rtk git commit -m "fix(app): correct scroll-bottom distance check to fix jump-to-bottom visibility"
```
