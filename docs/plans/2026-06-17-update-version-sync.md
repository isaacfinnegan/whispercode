# Align Package Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the outdated package versions of VS Code SDK and Android packages from `1.17.3` to the workspace version `1.17.7`, update `bun.lock` to reflect changes, and verify all builds pass.

**Architecture:** Update version strings directly in package files (`sdks/vscode/package.json` and `packages/android/package.json`) and run `bun install` to update `bun.lock` dependency tracking in the workspace. Verify that the build pipelines for VS Code and Android still compile successfully.

**Tech Stack:** Bun, TypeScript, Node.js, Git

---

### Task 1: Create Git Branch

**Files:**
- Modify: None

- [ ] **Step 1: Create a new branch for the feature**

Run: `git checkout -b align-package-versions`
Expected: Switched to a new branch 'align-package-versions'

- [ ] **Step 2: Verify git status is clean**

Run: `git status`
Expected: Working tree has no changes in tracked files (only untracked files are acceptable)

- [ ] **Step 3: Commit**

Skip commit for branch creation.

### Task 2: Align VS Code Extension version in sdks/vscode/package.json

**Files:**
- Modify: `sdks/vscode/package.json`

- [ ] **Step 1: Write verification script to assert the current version is 1.17.3**

Run: `node -e "const pkg = require('./sdks/vscode/package.json'); if (pkg.version !== '1.17.3') throw new Error('Expected 1.17.3, got ' + pkg.version)"`
Expected: Command exits successfully with code 0

- [ ] **Step 2: Update VS Code package version to 1.17.7**

Replace:
```json
  "version": "1.17.3",
```
with:
```json
  "version": "1.17.7",
```
in `sdks/vscode/package.json`.

- [ ] **Step 3: Run verification script to assert the updated version is 1.17.7**

Run: `node -e "const pkg = require('./sdks/vscode/package.json'); if (pkg.version !== '1.17.7') throw new Error('Expected 1.17.7, got ' + pkg.version)"`
Expected: Command exits successfully with code 0

- [ ] **Step 4: Commit**

Run: `git add sdks/vscode/package.json && git commit -m "chore(sdk): update VS Code extension version to 1.17.7"`
Expected: Commit successful

### Task 3: Align Android package version in packages/android/package.json

**Files:**
- Modify: `packages/android/package.json`

- [ ] **Step 1: Write verification script to assert the current version is 1.17.3-whispercode-672**

Run: `node -e "const pkg = require('./packages/android/package.json'); if (pkg.version !== '1.17.3-whispercode-672') throw new Error('Expected 1.17.3-whispercode-672, got ' + pkg.version)"`
Expected: Command exits successfully with code 0

- [ ] **Step 2: Update Android package version to 1.17.7-whispercode-672**

Replace:
```json
  "version": "1.17.3-whispercode-672",
```
with:
```json
  "version": "1.17.7-whispercode-672",
```
in `packages/android/package.json`.

- [ ] **Step 3: Run verification script to assert the updated version is 1.17.7-whispercode-672**

Run: `node -e "const pkg = require('./packages/android/package.json'); if (pkg.version !== '1.17.7-whispercode-672') throw new Error('Expected 1.17.7-whispercode-672, got ' + pkg.version)"`
Expected: Command exits successfully with code 0

- [ ] **Step 4: Commit**

Run: `git add packages/android/package.json && git commit -m "chore(android): update Android package version to 1.17.7-whispercode-672"`
Expected: Commit successful

### Task 4: Regenerate lockfile bun.lock

**Files:**
- Modify: `bun.lock`

- [ ] **Step 1: Verify current lockfile contains the old versions**

Run: `grep -q "1.17.3-whispercode-672" bun.lock`
Expected: Command exits with 0 (match found)

- [ ] **Step 2: Run bun install to regenerate lockfile**

Run: `/Users/isaac/.bun/bin/bun install`
Expected: Installation completes, updating `bun.lock`

- [ ] **Step 3: Verify the lockfile contains the updated versions**

Run: `grep -q "1.17.7-whispercode-672" bun.lock && ! grep -q "1.17.3-whispercode-672" bun.lock`
Expected: Command exits with 0 (new version exists, old version is removed)

- [ ] **Step 4: Commit**

Run: `git add bun.lock && git commit -m "chore: regenerate bun.lock with updated package versions"`
Expected: Commit successful

### Task 5: Verify VS Code SDK package compiles successfully

**Files:**
- Modify: None
- Test: None

- [ ] **Step 1: Run compilation check**

Run: `bun run compile` in `sdks/vscode` directory
Expected: `bun run compile` command completes successfully with exit code 0

- [ ] **Step 2: Commit**

Skip commit since no files were modified.

### Task 6: Verify Android package compiles successfully

**Files:**
- Modify: None
- Test: None

- [ ] **Step 1: Run build check**

Run: `bun run build` in `packages/android` directory
Expected: `bun run build` command completes successfully with exit code 0

- [ ] **Step 2: Commit**

Skip commit since no files were modified.
