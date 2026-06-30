# Resolve Version and Terminal Settings Mismatch Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain and resolve the version discrepancy (`1.17.10` vs `1.17.11`) and show/enable terminal settings and buttons in the UI.

**Architecture:** Verify the execution channel (production web proxy vs local development frontend). Document the necessary steps to launch local development servers for both the web app and the desktop client to run the local `1.17.11` codebase.

**Tech Stack:** SolidJS, Tauri, Electron, Bun

---

## Steps to Verify and Resolve

- [ ] Task 1: Check running environment configuration
  - Determine if the user is using `opencode dev web` which proxies production `https://app.opencode.ai` (running `1.17.10`).
  - Explain that the terminal settings (`8491bdd20b`) and the terminal button toggle (`74626f8fba`) are local commits on the `dev` branch and not yet deployed to the production `1.17.10` client.

- [ ] Task 2: Launch the local frontend development server
  - Stop the production web proxy.
  - Start the backend server in conditions=browser mode:
    ```bash
    bun run --cwd packages/opencode dev serve --port 4096
    ```
  - Start the app development server:
    ```bash
    bun run --cwd packages/app dev -- --port 4444
    ```
  - Access the application locally at `http://localhost:4444`.

- [ ] Task 3: Run the local desktop client wrapper (if using desktop)
  - If Tauri wrapper is used, run:
    ```bash
    bun run --cwd packages/desktop tauri dev
    ```
  - If Electron wrapper is used, run:
    ```bash
    bun run --cwd packages/desktop-electron dev
    ```
