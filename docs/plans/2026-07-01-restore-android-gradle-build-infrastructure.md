# Restore Android Gradle Build Infrastructure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the deleted/ignored Android Gradle build files (including `buildSrc/`, `gradlew`, `gradle.properties`, etc.) and ensure they are unignored by `.gitignore` so the Android build can compile native Rust code using the custom `rust` plugin.

**Architecture:** Update the root `.gitignore` to explicitly unignore Gradle configuration files, wrappers, and the custom `buildSrc` plugin directory under `packages/android/src-tauri/gen/android/`. Use git to checkout these files from a known good commit (`d4c4b74403`).

**Tech Stack:** Git, Gradle, Tauri

---

### Task 1: Update .gitignore to preserve Android build files

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Edit .gitignore to unignore the Android build files**

Open `.gitignore` and add rules to unignore `buildSrc`, gradle wrappers, `gradle.properties`, and related configuration files under the android generation folder.

Replace the section around line 38:
```gitignore
packages/android/src-tauri/gen/*
!packages/android/src-tauri/gen/android/settings.gradle
packages/android/src-tauri/gen/android/app/**/*
!packages/android/src-tauri/gen/android/app/build.gradle.kts
!packages/android/src-tauri/gen/android/app/google-services.json
```

With:
```gitignore
packages/android/src-tauri/gen/*
!packages/android/src-tauri/gen/android/settings.gradle
!packages/android/src-tauri/gen/android/build.gradle.kts
!packages/android/src-tauri/gen/android/gradle.properties
!packages/android/src-tauri/gen/android/gradlew
!packages/android/src-tauri/gen/android/gradlew.bat
!packages/android/src-tauri/gen/android/gradle/
!packages/android/src-tauri/gen/android/gradle/wrapper/
!packages/android/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar
!packages/android/src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties
!packages/android/src-tauri/gen/android/buildSrc/
!packages/android/src-tauri/gen/android/buildSrc/**/*
packages/android/src-tauri/gen/android/app/**/*
!packages/android/src-tauri/gen/android/app/build.gradle.kts
!packages/android/src-tauri/gen/android/app/google-services.json
```

- [ ] **Step 2: Commit .gitignore changes**

Run:
```bash
rtk git add .gitignore
rtk git commit -m "chore(android): update gitignore to track android buildSrc and gradle wrappers"
```

---

### Task 2: Restore the missing Android Gradle files from git history

**Files:**
- Restore: `packages/android/src-tauri/gen/android/buildSrc/**/*`
- Restore: `packages/android/src-tauri/gen/android/gradle/**/*`
- Restore: `packages/android/src-tauri/gen/android/gradlew`
- Restore: `packages/android/src-tauri/gen/android/gradlew.bat`
- Restore: `packages/android/src-tauri/gen/android/gradle.properties`
- Restore: `packages/android/src-tauri/gen/android/.editorconfig`

- [ ] **Step 1: Checkout the missing files from commit d4c4b74403**

Run:
```bash
rtk git checkout d4c4b74403 -- \
  packages/android/src-tauri/gen/android/buildSrc \
  packages/android/src-tauri/gen/android/gradle \
  packages/android/src-tauri/gen/android/gradlew \
  packages/android/src-tauri/gen/android/gradlew.bat \
  packages/android/src-tauri/gen/android/gradle.properties \
  packages/android/src-tauri/gen/android/.editorconfig
```

- [ ] **Step 2: Track these files in git**

Run:
```bash
rtk git add \
  packages/android/src-tauri/gen/android/buildSrc \
  packages/android/src-tauri/gen/android/gradle \
  packages/android/src-tauri/gen/android/gradlew \
  packages/android/src-tauri/gen/android/gradlew.bat \
  packages/android/src-tauri/gen/android/gradle.properties \
  packages/android/src-tauri/gen/android/.editorconfig
```

- [ ] **Step 3: Commit the restored files**

Run:
```bash
rtk git commit -m "chore(android): restore missing gradle wrappers and buildSrc plugin"
```

---

### Task 3: Build and verify the Android package locally

**Files:**
- Verify: `./packages/android/build-and-install.sh`

- [ ] **Step 1: Run the build-and-install script**

Run:
```bash
PATH="/Users/isaac/.local/bin:/Users/isaac/.bun/bin:$PATH" ./packages/android/build-and-install.sh
```
Expected output: Successful compilation of the CLI, frontend, and successful assembly of `app-arm64-debug.apk`.
