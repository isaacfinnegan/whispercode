# Fix Web UI Version and Terminal Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the local development server serves the correct Web UI version (1.17.11) with the terminal settings toggle, and guarantee future setups automatically build these files on installation.

**Architecture:**
1. Update the root `package.json`'s `postinstall` hook to build the local frontend assets (`packages/app/dist`) automatically on dependency installation.
2. Add a clear warning log to `serveUIEffect` in the backend so developers are notified when local assets are missing and the server is falling back to proxying production.

**Tech Stack:** Bun, SolidJS, Vite, Node/Effect

---

### Task 1: Update Root Package JSON Postinstall Hook

**Files:**
- Modify: `package.json:18`

- [ ] **Step 1: Modify package.json postinstall command**
Change line 18 in `package.json` to include the app build step:
```json
    "postinstall": "bun run --cwd packages/core fix-node-pty && bun run --cwd packages/app build",
```

- [ ] **Step 2: Run bun install to verify postinstall execution**
Run: `bun install`
Expected output: Successful package installation followed by `Building Web UI` output and generation of `packages/app/dist/index.html`.

- [ ] **Step 3: Commit the package.json change**
```bash
rtk git add package.json
rtk git commit -m "build: compile web UI assets automatically on postinstall"
```

### Task 2: Add Proxy Warning Log in Server UI Handler

**Files:**
- Modify: `packages/opencode/src/server/shared/ui.ts:117`

- [ ] **Step 1: Add warning logging statement to serveUIEffect**
Read the file around line 117. Add an Effect log statement for the root/index.html path when falling back to proxying:
```typescript
    if (requestPath === "/" || requestPath === "/index.html") {
      yield* Effect.logWarning(
        `Local Web UI assets not found in ${localDistPath || "packages/app/dist"}. Proxying UI to ${upstream.origin}. ` +
          `To serve local assets, run 'bun run --cwd packages/app build'.`,
      )
    }
```

- [ ] **Step 2: Verify typecheck passes**
Run: `bun run --cwd packages/opencode typecheck`
Expected output: No compilation or type errors.

- [ ] **Step 3: Run the tests to ensure no regressions**
Run: `bun run --cwd packages/opencode test -- test/server/httpapi-ui.test.ts`
Expected output: All UI fallback tests pass.

- [ ] **Step 4: Commit the UI server change**
```bash
rtk git add packages/opencode/src/server/shared/ui.ts
rtk git commit -m "feat(server): log warning when proxying to production instead of local UI"
```

### Task 3: Verify Serving Local Assets and Settings Dialog

**Files:**
- Modify: None (pure verification task)

- [ ] **Step 1: Start local backend server**
Run: `bun dev serve --port 4096`

- [ ] **Step 2: Access local UI and inspect settings dialog**
Open a browser and navigate to `http://localhost:4096`. Click Settings.
Expected output: Settings dialog opens, displaying version `1.17.11`, and the "Terminal" toggle switch is present under the "Advanced" section.
