# View Plan Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept and view plan files (`docs/plans/*.md` or `/plans/*.md`) in a styled checklist interface with toggles between visual plan mode and raw code mode inside timeline/file tabs.

**Architecture:** Use a conditional switch inside the `File` component of `packages/session-ui/src/components/file.tsx` to detect plan files. Render a custom `PlanViewer` component that calculates task progress stats using regex and displays a formatted `<Markdown>` view or falls back to the original `TextViewer` component. Style visual components and task checklists in `file.css` and `markdown.css`.

**Tech Stack:** SolidJS, TypeScript, CSS Variables

---

## Phase 1: Style Definitions

- [ ] **Task 1.1: Add plan viewer container and toggle control styles**
  Append the following CSS declarations to `packages/session-ui/src/components/file.css`:
  ```css
  /* Plan Viewer Layout */
  .plan-viewer-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--background-base, #ffffff);
    overflow: hidden;
  }

  .plan-viewer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 0.5px solid var(--border-weak-base, var(--v2-border-border-muted, #e5e5e5));
    background-color: var(--background-stronger, #f9f9f9);
    user-select: none;
    flex-shrink: 0;
  }

  .plan-viewer-progress-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .plan-viewer-progress-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong, #111111);
  }

  .plan-viewer-progress-bar-container {
    width: 160px;
    height: 6px;
    background-color: var(--background-base, #ffffff);
    border-radius: 9999px;
    overflow: hidden;
    border: 0.5px solid var(--border-weak-base, #e5e5e5);
  }

  .plan-viewer-progress-bar-fill {
    height: 100%;
    background-color: var(--syntax-success, #22c55e);
    border-radius: 9999px;
    transition: width 0.3s ease;
  }

  .plan-viewer-no-tasks {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-weak, #666666);
  }

  .plan-viewer-toggle-group {
    display: flex;
    align-items: center;
    background-color: var(--background-base, #ffffff);
    border-radius: 6px;
    padding: 2px;
    border: 0.5px solid var(--border-weak-base, #e5e5e5);
  }

  .plan-viewer-toggle-button {
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    background: transparent;
    color: var(--text-weak, #666666);
    transition: all 0.2s ease;
  }

  .plan-viewer-toggle-button:hover {
    color: var(--text-strong, #111111);
  }

  .plan-viewer-toggle-button.active {
    background-color: var(--background-stronger, #f9f9f9);
    color: var(--text-strong, #111111);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .plan-viewer-content {
    flex: 1;
    overflow-y: auto;
    padding: 24px;
  }
  ```

- [ ] **Task 1.2: Add markdown checklist card styles**
  Append the following checklist styles to `packages/session-ui/src/components/markdown.css`:
  ```css
  /* Custom checklist styling for Visual Plan preview */
  [data-plan-preview="true"] ul {
    list-style-type: none;
    padding-left: 0;
  }

  [data-plan-preview="true"] .task-list-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    padding: 12px 16px;
    background-color: var(--background-stronger, #f9f9f9);
    border: 1px solid var(--border-weak-base, #e5e5e5);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
    transition: all 0.2s ease-in-out;
  }

  [data-plan-preview="true"] .task-list-item:hover {
    border-color: var(--border-base, #cccccc);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  }

  [data-plan-preview="true"] .task-list-item input[type="checkbox"] {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-base, #cccccc);
    border-radius: 4px;
    outline: none;
    background-color: var(--background-base, #ffffff);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
    position: relative;
    transition: all 0.2s ease;
  }

  [data-plan-preview="true"] .task-list-item input[type="checkbox"]:checked {
    background-color: var(--syntax-success, #22c55e);
    border-color: var(--syntax-success, #22c55e);
  }

  [data-plan-preview="true"] .task-list-item input[type="checkbox"]:checked::after {
    content: "";
    display: block;
    width: 5px;
    height: 10px;
    border: solid #ffffff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg) translate(-0.5px, -1px);
  }

  [data-plan-preview="true"] .task-list-item:has(input[type="checkbox"]:checked) {
    opacity: 0.6;
    text-decoration: line-through;
    background-color: var(--background-base, #ffffff);
    border-color: var(--border-weak-base, #e5e5e5);
  }
  ```

---

## Phase 2: Component Implementation

- [ ] **Task 2.1: Add Markdown imports and helper functions to `packages/session-ui/src/components/file.tsx`**
  Modify imports and helper scopes at `packages/session-ui/src/components/file.tsx`:
  - Add import for `Markdown` from `./markdown`:
    ```typescript
    import { Markdown } from "./markdown"
    ```
  - Define `isPlanFile` helper near the bottom:
    ```typescript
    const isPlanFile = (path: string | undefined): boolean => {
      if (!path) return false
      return path.endsWith(".md") && (path.includes("docs/plans/") || path.includes("/plans/"))
    }
    ```

- [ ] **Task 2.2: Implement `PlanViewer` component in `packages/session-ui/src/components/file.tsx`**
  Add the `PlanViewer` helper component above the `File` export:
  ```typescript
  function PlanViewer<T>(props: TextFileProps<T>) {
    const [viewMode, setViewMode] = createSignal<"visual" | "code">("visual")

    const text = () => {
      const value = props.file.contents as unknown
      if (typeof value === "string") return value
      if (Array.isArray(value)) return value.join("\n")
      if (value == null) return ""
      return String(value)
    }

    const taskCount = () => {
      const t = text()
      const matches = t.match(/-\s*\[[ xX]\]/g)
      return matches ? matches.length : 0
    }

    const completedCount = () => {
      const t = text()
      const matches = t.match(/-\s*\[[xX]\]/g)
      return matches ? matches.length : 0
    }

    const progressPercent = () => {
      const total = taskCount()
      if (total === 0) return 0
      return Math.round((completedCount() / total) * 100)
    }

    return (
      <Show when={viewMode() === "visual"} fallback={TextViewer(props)}>
        <div class="plan-viewer-container" data-component="plan-viewer">
          <div class="plan-viewer-header">
            <div class="plan-viewer-progress-info">
              <Show when={taskCount() > 0} fallback={<div class="plan-viewer-no-tasks">No tasks defined in plan file</div>}>
                <div class="plan-viewer-progress-label">
                  {completedCount()} of {taskCount()} tasks completed ({progressPercent()}%)
                </div>
                <div class="plan-viewer-progress-bar-container">
                  <div class="plan-viewer-progress-bar-fill" style={{ width: `${progressPercent()}%` }} />
                </div>
              </Show>
            </div>
            <div class="plan-viewer-toggle-group">
              <button
                type="button"
                class={`plan-viewer-toggle-button ${viewMode() === "visual" ? "active" : ""}`}
                onClick={() => setViewMode("visual")}
              >
                Visual Plan
              </button>
              <button
                type="button"
                class={`plan-viewer-toggle-button ${viewMode() === "code" ? "active" : ""}`}
                onClick={() => setViewMode("code")}
              >
                Raw Code
              </button>
            </div>
          </div>
          <div class="plan-viewer-content" data-plan-preview="true">
            <Markdown text={text()} class="select-text prose max-w-none" />
          </div>
        </div>
      </Show>
    )
  }
  ```

- [ ] **Task 2.3: Integrate `PlanViewer` inside the `File` component export**
  Update the `File` component logic at the bottom of `packages/session-ui/src/components/file.tsx`:
  ```typescript
  export function File<T>(props: FileProps<T>) {
    if (props.mode === "text") {
      const isPlan = () => isPlanFile(props.file?.name)
      return <FileMedia media={props.media} fallback={() => isPlan() ? PlanViewer(props) : TextViewer(props)} />
    }

    return <FileMedia media={props.media} fallback={() => DiffViewer(props)} />
  }
  ```

---

## Phase 3: Documentation and Verification

- [ ] **Task 3.1: Document implementation in `MERGE_NOTES.md`**
  Append a subsection under `### C. Session UI (packages/session-ui)` to details fork changes:
  ```markdown
  ### C. Session UI (`packages/session-ui`)

  WhisperCode introduces custom rendering for plan files (matching `docs/plans/*.md` or `/plans/*.md` file paths) to display a checklist interface rather than raw markdown code views:

  - **`packages/session-ui/src/components/file.tsx`**: Intercepts plan text files, rendering a custom `PlanViewer` wrapper with a toggle switch between "Visual Plan" and "Raw Code", task checklists count calculation, and progress bar visualization.
  - **`packages/session-ui/src/components/file.css`**: Defines layout classes for `PlanViewer` header, buttons, and progress tracking bars.
  - **`packages/session-ui/src/components/markdown.css`**: Scopes checkbox list card and text formats under `[data-plan-preview="true"]` attributes.
  ```

- [ ] **Task 3.2: Verify type checks and test suite**
  Run:
  ```bash
  export PATH="/Users/isaac/bin:/Users/isaac/.bun/bin:$PATH"
  bun run --cwd packages/session-ui typecheck
  bun run --cwd packages/session-ui test
  ```
  Ensure all 57 tests pass and there are no compilation errors.
