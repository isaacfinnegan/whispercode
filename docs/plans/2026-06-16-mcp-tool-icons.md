# Tool Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render tool icons (like the MCP icon or specific built-in tool icons) in the web client timeline when tools are called.

**Architecture:** Update the `BasicTool` component in `packages/ui/src/components/basic-tool.tsx` to render the `icon` or a `Spinner` within the tool trigger structure. The component already receives the `icon` and `status` properties, and the CSS already has rules for styling `basic-tool-tool-indicator`, `basic-tool-tool-spinner`, and `icon-svg` elements, but the JSX was missing the actual element rendering.

**Tech Stack:** SolidJS, TypeScript, Tailwind/CSS.

---

### Step 1: Import dependencies in `basic-tool.tsx`

- [ ] Read the current imports at the top of `packages/ui/src/components/basic-tool.tsx`.
- [ ] Add imports for the `Icon` and `Spinner` components:
  ```typescript
  import { Icon } from "./icon"
  import { Spinner } from "./spinner"
  ```

### Step 2: Render the Icon / Spinner inside BasicTool

- [ ] Locate the `trigger` JSX element definition inside `packages/ui/src/components/basic-tool.tsx`:
  ```typescript
  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <div data-slot="basic-tool-tool-info">
  ```
- [ ] Update it to render the `<Show>` element mapping `pending()` to the spinner/icon containers:
  ```typescript
  const trigger = () => (
    <div
      data-component="tool-trigger"
      data-clickable={props.clickable ? "true" : undefined}
      data-hide-details={props.hideDetails ? "true" : undefined}
    >
      <div data-slot="basic-tool-tool-trigger-content">
        <Show
          when={pending()}
          fallback={
            <span data-slot="basic-tool-tool-indicator">
              <Icon name={props.icon} size="small" />
            </span>
          }
        >
          <span data-slot="basic-tool-tool-spinner">
            <Spinner />
          </span>
        </Show>
        <div data-slot="basic-tool-tool-info">
  ```

### Step 3: Run type checking and validation

- [ ] Run `bun typecheck` to verify that there are no TypeScript compile errors in the UI package.
