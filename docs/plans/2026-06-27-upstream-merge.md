# Upstream Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge 333 commits from `upstream/dev` into the current `dev` branch while preserving WhisperCode-specific mobile fork features, dependencies, and settings.

**Architecture:** We will create a local branch named `dev-merge-upstream`, execute the git merge command, resolve all identified conflicts (specifically preserving mobile wrappers, pinned dependency versions, and custom SolidJS/Tauri bridge code), regenerate the SDK/API surface, rebuild the CLI, and run the test suites to ensure parity.

**Tech Stack:** Git, Bun, TypeScript, Rust/Tauri

---

### Task 1: Create merge branch and run git merge

**Files:**
- Create branch: `dev-merge-upstream`

- [ ] **Step 1: Check out a new branch to isolate the merge**

Run: `git checkout -b dev-merge-upstream`
Expected: Switched to a new branch 'dev-merge-upstream'

- [ ] **Step 2: Pull latest commits from upstream/dev to ensure we are up to date**

Run: `git fetch upstream dev`
Expected: Fetch complete

- [ ] **Step 3: Run git merge command to initiate the merge**

Run: `git merge upstream/dev --no-commit --no-ff`
Expected: Merge starts with conflicts listed in AGENTS.md, bun.lock, packages/app/package.json, packages/app/src/app.tsx, packages/app/src/components/help-button.tsx, packages/app/src/components/prompt-input.tsx, packages/app/src/components/session/session-header.tsx, packages/app/src/context/directory-sync.ts, packages/app/src/context/global-sync/bootstrap.test.ts, packages/app/src/context/notification.tsx, packages/app/src/context/server-sync.tsx, packages/app/src/pages/layout.tsx, packages/app/src/pages/new-session.tsx, packages/app/src/pages/session.tsx, packages/app/src/pages/session/composer/session-composer-region.tsx, packages/session-ui/src/components/line-comment-annotations.tsx, packages/ui/src/v2/components/icon.tsx, script/publish.ts

- [ ] **Step 4: Commit branch state (with conflicts marked in working copy)**

We keep the merge in a conflicted state while we resolve file-by-file in the next tasks.

---

### Task 2: Resolve conflicts in AGENTS.md, script/publish.ts, and package/dependency files

**Files:**
- Modify: `AGENTS.md`
- Modify: `packages/app/package.json`
- Modify: `script/publish.ts`
- Modify: `bun.lock`

- [ ] **Step 1: Resolve AGENTS.md conflicts**

Open `AGENTS.md`. Keep all custom WhisperCode sections (such as Bun and Rust PATH rules, Ghostty-web dependency pins, Android version sync scripts, GitNexus graph info, etc.) and merge any new guidelines from upstream.

- [ ] **Step 2: Resolve packages/app/package.json conflicts**

Open `packages/app/package.json`. Make sure that:
1. `"ghostty-web"` dependency is pinned exactly to `"github:anomalyco/ghostty-web#20bd361"`.
2. Clean up any duplicated packages or duplicate keys.

- [ ] **Step 3: Resolve script/publish.ts conflicts**

Open `script/publish.ts`. Ensure we preserve any mobile-specific custom publish code or configurations while incorporating upstream build improvements.

- [ ] **Step 4: Regenerate lockfile to resolve conflicts**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun install`
Expected: bun.lock conflict is resolved and packages are successfully installed.

- [ ] **Step 5: Verify build files can compile**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run typecheck`
Expected: Verification script runs without error or shows only source-level conflicts to resolve next.

---

### Task 3: Resolve code conflicts in app, page, and component files

**Files:**
- Modify: `packages/app/src/app.tsx`
- Modify: `packages/app/src/components/help-button.tsx`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/session/session-header.tsx`
- Modify: `packages/app/src/pages/layout.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-region.tsx`

- [ ] **Step 1: Resolve help-button.tsx conflict**

Open `packages/app/src/components/help-button.tsx`. Following the fork guidelines, keep upstream files clean by returning `null` to minimize differences while resolving the conflict.

- [ ] **Step 2: Resolve session-header.tsx conflict**

Open `packages/app/src/components/session/session-header.tsx`. Ensure we retain our settings-driven terminal visibility logic:
```typescript
  const term = createMemo(() => settings.general.showTerminal())
```
Ensure the terminal toggle button remains wrapped in `<Show when={term()}>` in the fallback (classic) actions component, and the status/mobile refresh icons are preserved.

- [ ] **Step 3: Resolve app.tsx, prompt-input.tsx, layout.tsx, new-session.tsx, session.tsx, and session-composer-region.tsx conflicts**

Open each file and resolve conflicts, ensuring that:
1. SolidJS components use `createStore` instead of multiple `createSignal` calls.
2. Platform checks (such as `platform.platform === "ios"` or `"android"`) and mobile-specific routing are kept intact.
3. Mobile layout designs and horizontal/vertical spacing for mobile are preserved.

- [ ] **Step 4: Verify typecheck runs**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run typecheck`
Expected: PASS

---

### Task 4: Resolve conflicts in core/context files

**Files:**
- Modify: `packages/app/src/context/directory-sync.ts`
- Modify: `packages/app/src/context/global-sync/bootstrap.test.ts`
- Modify: `packages/app/src/context/notification.tsx`
- Modify: `packages/app/src/context/server-sync.tsx`
- Modify: `packages/session-ui/src/components/line-comment-annotations.tsx`
- Modify: `packages/ui/src/v2/components/icon.tsx`

- [ ] **Step 1: Resolve directory-sync.ts, notification.tsx, and server-sync.tsx conflicts**

Open each file and resolve conflicts. Make sure that push notification pairing, sync hooks, and platform-specific data synchronization states are preserved.

- [ ] **Step 2: Resolve line-comment-annotations.tsx and icon.tsx conflicts**

Open the files and merge upstream V2 UI components while retaining mobile icons and visual alignment options.

- [ ] **Step 3: Resolve bootstrap.test.ts conflicts**

Open `packages/app/src/context/global-sync/bootstrap.test.ts` and merge tests.

- [ ] **Step 4: Verify all packages/app tests pass**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && rtk bun run --cwd packages/app test:unit`
Expected: PASS with 0 failures

---

### Task 5: Finalize merge, regenerate SDK, build, and commit

**Files:**
- Modify: None (build artifacts only)

- [ ] **Step 1: Run code generation script**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run ./script/generate.ts`
Expected: SDK and API routes regenerated successfully.

- [ ] **Step 2: Regenerate JS SDK**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run --cwd packages/sdk/js build`
Expected: SDK rebuilds successfully.

- [ ] **Step 3: Rebuild the CLI**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run --cwd packages/opencode build`
Expected: CLI build succeeds with smoke test passing.

- [ ] **Step 4: Run full packages/app unit tests**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && rtk bun run --cwd packages/app test:unit`
Expected: PASS with 0 failures

- [ ] **Step 5: Run full packages/opencode unit tests**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && rtk bun run --cwd packages/opencode test`
Expected: PASS

- [ ] **Step 6: Sync Android version**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && bun run script/sync-android-version.ts`
Expected: Android package version synced with workspace version.

- [ ] **Step 7: Commit the merge**

Run: `git commit -m "merge: sync with upstream/dev up to ae53163cad"`
Expected: Commit succeeds

- [ ] **Step 8: Push branch and create PR**

Run: `git push -u origin dev-merge-upstream`
Expected: Push succeeds and outputs branch URL.
