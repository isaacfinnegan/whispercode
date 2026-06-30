# Prevent External Directory Permission Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the application from requesting directory permissions beyond the workspace when scanning directories or projects by prioritizing the workspace directory in the directory picker.

**Architecture:** Modify `packages/app/src/components/dialog-select-directory.tsx` to prioritize `sync.data.path.directory` over `sync.data.path.home` in the `start` memo. This ensures that the directory picker starts in the folder where the app was launched (e.g., `~/Projects`) rather than defaulting to `~` (home directory), preventing the home directory from being queried on startup.

**Tech Stack:** TypeScript, Bun, SolidJS, Effect-TS

---

### Task 1: Prioritize Current Directory in Directory Picker (Frontend Usability)

**Files:**
- Modify: `packages/app/src/components/dialog-select-directory.tsx`

- [ ] **Step 1: Edit packages/app/src/components/dialog-select-directory.tsx**
  
  Locate the `start` memo definition and prioritize `directory` over `home`:
  ```typescript
  const start = createMemo(
    () => sync.data.path.directory || sync.data.path.home || fallbackPath()?.directory || fallbackPath()?.home,
  )
  ```

- [ ] **Step 2: Run typecheck**
  
  Run typescript checks in the `packages/app` directory to verify there are no compilation errors:
  ```bash
  export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck
  ```

---

### Task 2: Verify and Commit

**Files:**
- None

- [ ] **Step 1: Commit the changes**
  
  Stage the file, inspect git diff, and commit the changes using the conventional commit format:
  ```bash
  git add packages/app/src/components/dialog-select-directory.tsx
  git commit -m "fix(app): prioritize launch directory over home in directory picker"
  ```
