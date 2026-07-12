# Expose Advanced Settings on Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the "Advanced" settings section to the Web client so users can toggle the custom agents/modes selector.

**Architecture:** Remove the `<Show when={desktop()}>` guard wrapping `<AdvancedSection />` inside `packages/app/src/components/settings-general.tsx`.

**Tech Stack:** SolidJS, TypeScript, Bun

---

### Task 1: Expose Advanced Section in general settings component

**Files:**

- Modify: `packages/app/src/components/settings-general.tsx`

- [ ] **Step 1: Read `settings-general.tsx` to locate the `<AdvancedSection />` render block**

Ensure we locate the exact lines wrapping the `<AdvancedSection />` tag.

- [ ] **Step 2: Modify the code to remove the `<Show when={desktop()}>` wrapper**

Update `packages/app/src/components/settings-general.tsx`:

Replace:

```tsx
<Show when={desktop()}>
  <AdvancedSection />
</Show>
```

With:

```tsx
<AdvancedSection />
```

- [ ] **Step 3: Run typecheck inside `packages/app` package directory**

Run: `bun typecheck` in `/Users/isaac/Projects/whispercode/packages/app` to verify no type compilation issues are introduced.
Expected: PASS with no compilation errors.

- [ ] **Step 4: Commit the change**

Run:

```bash
git add packages/app/src/components/settings-general.tsx
git commit -m "feat(app): expose advanced settings section on all platforms"
```
