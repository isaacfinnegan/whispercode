# Fix Plan Markdown Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix markdown formatting and missing checkboxes in the Visual Plan checklist viewer by allowing form input tags in DOMPurify and adding specific markdown styles.

**Architecture:** Update the DOMPurify config in the markdown cache to preserve `<input>` checkbox tags. Add explicit, high-specificity styles to override classic layout defaults for headers, paragraphs, and list margins under `[data-plan-preview="true"]` containers.

**Tech Stack:** TypeScript, CSS, DOMPurify, Marked

---

### Task 1: Update DOMPurify Config to Preserve Checkboxes

**Files:**
- Modify: `packages/session-ui/src/components/markdown-cache.tsx`

- [ ] **Step 1.1: Add input tags and checkbox attributes to the sanitize config**
  Read `packages/session-ui/src/components/markdown-cache.tsx` lines 13-20. Modify `config` to add `"input"` to `ADD_TAGS` and `"type"`, `"disabled"`, `"checked"` to `ADD_ATTR`:
  ```typescript
  const config = {
    USE_PROFILES: { html: true, mathMl: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style"],
    FORBID_CONTENTS: ["style", "script"],
    ADD_TAGS: ["svg", "path", "input"],
    ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target", "type", "disabled", "checked"],
  }
  ```

- [ ] **Step 1.2: Verify code syntax typechecks**
  Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/session-ui typecheck`
  Expected: Successful compilation without errors.

---

### Task 2: Add Plan Markdown Element Styles

**Files:**
- Modify: `packages/session-ui/src/components/markdown.css`

- [ ] **Step 2.1: Add specific heading and paragraph styles for plan preview**
  Append the following CSS rules to the bottom of `packages/session-ui/src/components/markdown.css` to override the classic layout's heading font resets:
  ```css
  /* High-specificity plan preview heading and text formats */
  [data-plan-preview="true"] [data-component="markdown"] h1,
  [data-plan-preview="true"] h1 {
    font-size: 20px !important;
    font-weight: 600 !important;
    margin-top: 24px !important;
    margin-bottom: 12px !important;
    color: var(--text-strong, #111111) !important;
    line-height: 1.4 !important;
  }

  [data-plan-preview="true"] [data-component="markdown"] h2,
  [data-plan-preview="true"] h2 {
    font-size: 16px !important;
    font-weight: 600 !important;
    margin-top: 20px !important;
    margin-bottom: 10px !important;
    color: var(--text-strong, #111111) !important;
    line-height: 1.4 !important;
  }

  [data-plan-preview="true"] [data-component="markdown"] h3,
  [data-plan-preview="true"] h3 {
    font-size: 14px !important;
    font-weight: 600 !important;
    margin-top: 16px !important;
    margin-bottom: 8px !important;
    color: var(--text-strong, #111111) !important;
    line-height: 1.4 !important;
  }

  [data-plan-preview="true"] [data-component="markdown"] p,
  [data-plan-preview="true"] p {
    font-size: 13px !important;
    line-height: 1.6 !important;
    margin-bottom: 12px !important;
    color: var(--text-base, #333333) !important;
  }

  [data-plan-preview="true"] [data-component="markdown"] ul,
  [data-plan-preview="true"] ul {
    margin-top: 12px !important;
    margin-bottom: 16px !important;
  }
  ```

---

### Task 3: Verify and Recompile

- [ ] **Step 3.1: Run the project-wide typecheck**
  Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run typecheck`
  Expected: Successful typecheck of all workspace packages.

- [ ] **Step 3.2: Recompile the binary and the Android APK**
  Run: `export PATH="/Users/isaac/.bun/bin:$PATH" && ./packages/android/build-and-install.sh`
  Expected: Successful compilation of the CLI backend and packaging of the APK.

- [ ] **Step 3.3: Document the modifications in MERGE_NOTES.md**
  Add details of the DOMPurify update to the `packages/session-ui` section in `MERGE_NOTES.md`.
