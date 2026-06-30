# Code-Printed Text Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automatic line-wrapping for code blocks and text outputs in the WhisperCode web app and CLI tool to prevent horizontal scrolling.

**Architecture:** Apply CSS white-space wrapping to UI-rendered code containers (`packages/ui/src/components/markdown.css`), verify terminal `FitAddon` configuration in the terminal emulator, and structure command-line wrapping options for script outputs.

**Tech Stack:** CSS (white-space, word-break), TypeScript/SolidJS, Bun

---

## Technical Options Analysis

### Option 1: UI Markdown Code Block Wrapping (CSS)
Apply CSS properties to the `<pre>` and `<code>` blocks rendered inside the chat messages to force them to wrap within their container.
- **Implementation:** Modify `packages/ui/src/components/markdown.css`.
- **CSS rules:**
  ```css
  [data-component="markdown"] pre {
    white-space: pre-wrap !important; /* Preserves spaces/tabs, wraps lines automatically */
    word-break: break-word;           /* Breaks words at logical boundaries */
    overflow-wrap: break-word;        /* Standard word break fallback */
  }
  ```

### Option 2: CLI/Terminal Column Synchronization (PTY)
Ensure the terminal layout dynamically resizes the PTY process columns when the terminal container width changes.
- **Implementation:** Utilize the `FitAddon` already loaded in `packages/app/src/components/terminal.tsx` to handle window resize and fit the PTY column size to the container.
- **Verification:** Ensure `fitAddon.fit()` is called on mount, on container resize, and when zoom levels change.

### Option 3: Pre-wrapping CLI Script Output (Node/Bun)
For CLI scripts printing long blocks of text or code to the console:
- **Implementation:** Query `process.stdout.columns` to get terminal width, and wrap lines dynamically using wrapping libraries like `wrap-ansi`.
- **Example:**
  ```typescript
  import wrapAnsi from 'wrap-ansi';
  const width = process.stdout.columns || 80;
  console.log(wrapAnsi(longText, width, { hard: true }));
  ```

---

## Tasks

- [ ] Task 1: Create a test layout with extra long code lines to verify scrolling behavior.
- [ ] Task 2: Implement Option 1 (CSS Wrapping) by adding styling to `packages/ui/src/components/markdown.css`.
- [ ] Task 3: Verify the CSS fix is responsive and preserves indentation.
- [ ] Task 4: Verify Option 2 (Terminal resizing) functions correctly on layout changes.
