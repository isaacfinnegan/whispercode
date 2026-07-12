# Optimize Android Build and Install Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize `packages/android/build-and-install.sh` to compile only the active host platform's binary, saving build time during local deployment.

**Architecture:** Add the `--single` flag to the `packages/opencode` build command in the shell script.

**Tech Stack:** Bash

---

### Task 1: Update Build Script

**Files:**

- Modify: `packages/android/build-and-install.sh:26`

- [ ] **Step 1: Edit the CLI build line in build-and-install.sh**
      Change line 26 from:

```bash
bun run --cwd "$SCRIPT_DIR/../../packages/opencode" build
```

To:

```bash
bun run --cwd "$SCRIPT_DIR/../../packages/opencode" build --single
```

- [ ] **Step 2: Commit the build-and-install.sh change**

```bash
rtk git add packages/android/build-and-install.sh
rtk git commit -m "build(android): compile single host CLI target in build-and-install script"
```
