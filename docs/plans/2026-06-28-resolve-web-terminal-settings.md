# Resolve Web Terminal Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the missing terminal toggle in the web settings menu by implementing a local UI assets fallback and a custom proxy target, allowing the local dev server to serve the latest web client assets directly.

**Architecture:** Update `packages/opencode/src/server/shared/ui.ts` to check if `packages/app/dist` exists locally and serve those static assets. If not found, proxy requests to `OPENCODE_UI_UPSTREAM` (which defaults to `https://app.opencode.ai`), allowing developers to point to their own local development server or custom target.

**Tech Stack:** TypeScript, Bun, Effect-TS (`effect`), `@opencode-ai/core/fs-util`

---

## Verification & Implementation Steps

### Task 1: Write Failing Tests for Custom Proxy Target and Local Dist Fallback

- [ ] **Step 1: Read the existing httpapi-ui test file**
      Read the file `packages/opencode/test/server/httpapi-ui.test.ts` to understand how the UI server middleware is currently tested.
      Command: `rtk read packages/opencode/test/server/httpapi-ui.test.ts`

- [ ] **Step 2: Add test cases to packages/opencode/test/server/httpapi-ui.test.ts**
      Add tests verifying that `serveUIEffect` respects the `OPENCODE_UI_UPSTREAM` environment variable and falls back to local dist files when `OPENCODE_LOCAL_DIST_PATH` is set and `index.html` is present.
      Use exact code replacements with the `edit` tool.

- [ ] **Step 3: Run the tests to confirm they fail**
      Execute the test command to verify the new test cases fail under the current implementation.
      Command: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/opencode test -- test/server/httpapi-ui.test.ts`
      Expected Output: Test failures on the new specs.

- [ ] **Step 4: Commit test file changes**
      Stage and commit only the test file.
      Command: `rtk git add packages/opencode/test/server/httpapi-ui.test.ts && rtk git commit -m "test: add failing tests for custom proxy target and local dist fallback"`

---

### Task 2: Implement Dynamic Upstream and Local Dist Fallback serving

- [ ] **Step 1: Read the UI serving middleware**
      Read `packages/opencode/src/server/shared/ui.ts` to understand the current routing and proxy logic.
      Command: `rtk read packages/opencode/src/server/shared/ui.ts`

- [ ] **Step 2: Implement the fallback and dynamic upstream resolution**
      Update `packages/opencode/src/server/shared/ui.ts` to:
  1. Define a `getUIUpstream` function resolving `process.env.OPENCODE_UI_UPSTREAM` with a fallback to `https://app.opencode.ai`.
  2. In `serveUIEffect`, check for `index.html` in the local dist folder using the filesystem service (`services.fs.existsSafe`).
  3. If present, read and serve the corresponding requested file or fallback to `index.html` (for SPA routing support).
     Use exact code replacements with the `edit` tool.

- [ ] **Step 3: Run tests to confirm they pass**
      Run the test suite to verify the implementation satisfies the new test cases.
      Command: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/opencode test -- test/server/httpapi-ui.test.ts`
      Expected Output: All tests pass.

- [ ] **Step 4: Perform a workspace-wide typecheck**
      Verify that the changes do not break compiling in any other parts of the monorepo.
      Command: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run typecheck`
      Expected Output: 0 compilation errors.

- [ ] **Step 5: Commit implementation changes**
      Stage and commit the modified ui module.
      Command: `rtk git add packages/opencode/src/server/shared/ui.ts && rtk git commit -m "feat(server): serve local UI assets when present and support OPENCODE_UI_UPSTREAM"`

---

### Task 3: Verify the Terminal Toggle on Web settings

- [ ] **Step 1: Build local app assets**
      Compile the local frontend client to create `packages/app/dist`.
      Command: `export PATH="/Users/isaac/.bun/bin:$PATH" && rtk bun run --cwd packages/app build`
      Expected Output: Static assets generated in `packages/app/dist`.

- [ ] **Step 2: Start the local opencode dev server**
      Launch the local dev server which will now serve our compiled local assets.
      Command: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096`

- [ ] **Step 3: Access the settings dialog in browser**
      Open `http://localhost:4096` in the browser, log in, navigate to Settings (mod+comma) > General, and confirm that under Advanced the terminal toggle is fully visible, clickable, and correctly synchronizes with the header terminal button visibility.

---

## Self-Review Checklist

- [x] Checks if the root cause of the missing setting on web has been explained.
- [x] Includes explicit test assertions for environment variables and filesystem checks.
- [x] Tasks are bite-sized (2-5 minutes each).
- [x] No placeholders or TBD values in code blocks or instructions.
