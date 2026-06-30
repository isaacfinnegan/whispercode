# Focus Chat Window on Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Focus the chat window / timeline scroll container upon prompt submission on mobile platforms, which transfers focus away from the text input and collapses the virtual keyboard.

**Architecture:** Update the `onSubmit` callback in `SessionComposerRegion` (within `packages/app/src/pages/session.tsx`) to check if the platform is mobile (`mobilePlatform()`) and, if so, call `scroller?.focus()`.

**Tech Stack:** SolidJS, TypeScript

---

### Task 1: Update onSubmit Handler in session.tsx

**Files:**
- Modify: `packages/app/src/pages/session.tsx`

- [ ] **Step 1: Verify typecheck passes before modification**

Run: `bun run typecheck`
Expected: Success

- [ ] **Step 2: Update the onSubmit handler**

Modify `packages/app/src/pages/session.tsx` around line 1693 to check `mobilePlatform()` and focus `scroller`:

```tsx
      onSubmit={() => {
        comments.clear()
        resumeScroll()
        if (mobilePlatform()) {
          scroller?.focus()
        }
      }}
```

- [ ] **Step 3: Run typecheck to verify it passes**

Run: `bun run typecheck`
Expected: Success

- [ ] **Step 4: Run unit tests to verify codebase health**

Run: `bun run --cwd packages/app test:unit`
Expected: Pass

- [ ] **Step 5: Commit changes**

```bash
rtk git add packages/app/src/pages/session.tsx
rtk git commit -m "feat(app): focus chat window on mobile submit to collapse keyboard"
```
