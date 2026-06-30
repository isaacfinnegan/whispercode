# Web UI Version and Terminal Settings Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and document the exact logic behind the versions displayed in the Web UI / Desktop App and trace the configuration options for the terminal settings.

**Architecture:** Analyze static definitions in settings stores and PTY terminal rendering layers. Document the dynamic endpoint response logic of the health endpoint and key properties loaded during terminal instantiation.

**Tech Stack:** TypeScript, SolidJS, Ghostty-web

---

## Verification Tasks

- [ ] Task 1: Verify Desktop App / Web UI static version source
  - Trace `platform.version` imported from package json.
  - Locate `packages/desktop/package.json` and compare version string (`1.17.11` in workspace, `1.17.10` visible in client).
  - Verify render location in settings dialog footer: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx`.

- [ ] Task 2: Trace dynamic Server Version source
  - Locate health controller handler: `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`.
  - Verify resolution of `InstallationVersion` from injected `OPENCODE_VERSION` compile global or fallback to local in `packages/core/src/installation/version.ts`.
  - Document the build-time injection from the version of `packages/opencode/package.json`.

- [ ] Task 3: Locate Terminal Settings & Font configuration properties
  - Trace `settings.appearance.terminalFont` in settings context: `packages/app/src/context/settings.tsx`.
  - Verify default value `"JetBrainsMono Nerd Font Mono"` and its fallback stack.
  - Locate terminal shell options loading and updates via server config update in `packages/app/src/components/settings-v2/general.tsx`.
  - Document default toggle terminal keybind `"ctrl+\`"` mapped to action `"terminal.toggle"`.
  - Verify scrollback size parameter (`scrollback: 10_000`) in `packages/app/src/components/terminal.tsx`.
