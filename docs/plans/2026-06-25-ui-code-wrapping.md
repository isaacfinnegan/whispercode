# UI Markdown Code Block Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable line-wrapping for code blocks inside rendered Markdown content to prevent horizontal sidescrolling.

**Architecture:** Edit `packages/ui/src/components/markdown.css` to add `white-space: pre-wrap` and word-breaking properties to code block containers. Run visual storybook/tests to verify the style is applied correctly and is responsive.

**Tech Stack:** CSS, Tailwind, SolidJS, Bun

---

## Tasks

- [ ] Task 1: Check baseline visual styling.
  - Run `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/ui test` to verify current test state.

- [ ] Task 2: Implement CSS styles for code block wrapping.
  - Locate `packages/ui/src/components/markdown.css`.
  - Modify the `pre` style rule at line 211 to include wrapping and word break behavior:
    ```css
    pre {
      margin-top: 12px;
      margin-bottom: 32px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;

      scrollbar-width: none;
      &::-webkit-scrollbar {
        display: none;
      }
    }
    ```

- [ ] Task 3: Verify the changes.
  - Run `export PATH="/Users/isaac/.bun/bin:$PATH" && bun run --cwd packages/ui test` to ensure no tests are broken.
  - Verify visually in development environment that long lines of code in markdown block format wrap properly at the container boundary rather than causing a horizontal scrollbar.
