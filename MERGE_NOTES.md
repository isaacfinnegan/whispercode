# WhisperCode Merge Notes

This file tracks the changes, additions, and divergence points implemented in **WhisperCode** (mobile fork) relative to the upstream **sst/opencode** repository. Use these notes as a guide to safely resolve merge conflicts and re-apply WhisperCode-specific customizations during upstream updates.

---

## 1. Wholly Owned Mobile and Push Packages

These packages are unique to WhisperCode and must be preserved in their entirety. Upstream merges may attempt to delete these directories since they do not exist in `sst/opencode`.

- **`packages/android/`**: Android Tauri wrapper application, containing Android Gradle configuration, MainActivity code, haptic/permission bridge definitions, and assets.
- **`packages/ios/`**: iOS native Swift application project, containing APNS push integration (`PushBridge.swift`), speech-to-text (`WhisperManager.swift`, `SpeechTranscriber.swift`), Keychain integration, and fastlane automation.
- **`packages/push/`**: Push notifications client library for configuring and triggering attention signals.
- **`packages/push-relay/`**: APNS and Android push notification relay server.

---

## 2. Wholly Owned Configuration and Utility Files

These files are added in WhisperCode and must not be overwritten or deleted during upstream sync:

- **`ANDROID_BUILD.md` & `IOS_BEAM.md`**: Native packaging and deployment documentation.
- **`.opencode/command/deploy-ios.md`**: Command definition for building and deploying the iOS app.
- **`script/sync-android-version.ts`**: Script to synchronize workspace versioning from `packages/app/package.json` to `packages/android/package.json`.
- **`.git/hooks/post-merge` & `post-rewrite`**: Hooks configured to run the version synchronization script automatically.
- **`whispercode-logo-light.png` & `whispercode-logo-dark.png`**: Fork-specific branding assets.

---

## 3. Fork-Specific Changes in Shared Packages

### A. Solid App (`packages/app`)

WhisperCode introduces deep native integrations, mobile settings, keyboard suppression, and programmatic focus guards:

#### I. Core Platform Context & Native API Extensions

- **`packages/app/src/context/platform.tsx`**: Extended the `Platform` type and provider to support mobile-specific APIs (Push pairing state, voice recording state, haptic feedback, and sharing utilities).
- **`packages/app/src/entry.tsx`**: Wider `platform.notify` argument signature to support mobile-specific push parameters (`NotifyOpts`) without breaking desktop or web implementations.
- **`packages/app/src/i18n/en.ts`**: Translation strings for mobile settings, voice/audio status, and push pairing options.

#### II. Suppressing the Virtual Keyboard (Autofocus & Submit Gating)

To prevent unexpected virtual keyboard popups on mobile touch browsers, programmatic input focus is guarded:

- **`packages/app/src/components/prompt-input.tsx`**: Guarded editor `mousedown` focus and voice input transcription auto-focus.
- **`packages/app/src/components/prompt-input/submit.ts`**: Prevents programmatic focus on submission failure or recovery when running on mobile.
- **`packages/app/src/pages/session.tsx`**: Gated session keydown/routing focus handlers, draft session mount autofocus, and added `scroller?.focus()` on submit to dismiss/collapse the keyboard.
- **`packages/app/src/pages/home.tsx`**: Gated menu/dialog mount autofocus on mobile v2 layouts.
- **`packages/app/src/components/terminal.tsx`**: Suppressed spelling, autocorrect, autocapitalize, autocomplete, and predictive text input buffering on touch keyboard inputs (`inputmode="url"` or `"email"`, `isMobilePlatform` helper via User Agent).

#### III. Mobile Settings, Push Notifications & Sync State

- **`packages/app/src/components/dialog-settings.tsx` & `packages/app/src/components/settings-general.tsx`**: Exposed a phone tab UI and settings for speech locales and push notifications.
- **`packages/app/src/components/settings-mobile-notifications*`**: Brand new files implementation for configuring mobile push notifications.
- **`packages/app/src/context/push-pair.tsx` & `packages/app/src/context/push-relay.tsx`**: Global context state files tracking pairing, device credentials, and relay endpoints.
- **`packages/app/src/context/todo-store.ts` & `packages/app/src/context/global-sync/event-reducer.ts`**: Caches and deep-copies todo payloads to prevent mutations and ensure correct offline/resume sync state behavior.

#### IV. App Dependency Rules

- **`packages/app/package.json`**: `"ghostty-web"` dependency is pinned to a stable commit (`github:anomalyco/ghostty-web#20bd361`) instead of `#main` to prevent install timeouts.

#### V. Terminal Toggle Visibility Settings

- **`packages/app/src/components/session/session-header.tsx`**: Updated the terminal toggle button `term` memo to respect `settings.general.showTerminal()` on all platforms (instead of hardcoding `true` on mobile), and wrapped the terminal toggle button in `<Show when={term()}>` in the classic fallback actions component. This allows the terminal button visibility to be controlled via settings across mobile, web, and desktop.
- **`packages/app/src/i18n/en.ts` & `packages/app/src/i18n/uk.ts`**: Generalized translation descriptions for terminal and navigation visibility switches to refer to "title bar" rather than "desktop title bar".

---

### B. Core CLI & Backend (`packages/opencode` & `packages/core`)

- **`packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`**:
  - _Change:_ Bypasses basic credential authentication for the `/global/health` check endpoint, allowing basic load balancers to poll system health securely.
- **`packages/cli/src/commands/handlers/serve.ts`**:
  - _Change:_ Binds to port `0` (dynamic port allocation) when port `4096` is already occupied, instead of looping up to port 65535.
- **`packages/server/src/handlers/provider.ts`**:
  - _Change:_ Blocks provider catalog requests until `PluginBoot` completes loading, preventing startup errors.
- **`packages/opencode/src/server/shared/ui.ts`**:
  - _Change:_ Corrected the local web UI fallback directory path resolution from `../../../../packages/app/dist` to `../../../../app/dist` to resolve the double `packages/packages` path mismatch. This allows the local backend server to correctly serve local app assets (including local settings and terminal button features) when present, rather than fallback proxying production UI.

---

### C. Session UI (`packages/session-ui`)

To enhance plan readability, WhisperCode introduces a formatted checklist preview for markdown plan files:

- **`packages/session-ui/src/components/file.tsx`**:
  - _Change:_ Added `PlanViewer` and `isPlanFile` helper to intercept text files ending in `.md` and containing `docs/plans/` or `/plans/`. Rather than rendering the raw markdown text inside `TextViewer`, the file is rendered using `PlanViewer` by default.
  - _Change:_ Added a toggle header allowing users to switch between the "Visual Plan" checklist mode (which leverages the custom `@opencode-ai/session-ui/markdown` component) and the "Raw Code" view mode. It computes task completion metrics dynamically via regex on checklist patterns (`- [ ]` / `- [x]`) and displays a visual progress bar.
- **`packages/session-ui/src/components/file.css`**:
  - _Change:_ Added container layout, progress bar, header, and toggle button styles for the custom PlanViewer.
- **`packages/session-ui/src/components/markdown.css`**:
  - _Change:_ Added special checklist styling targeted under `[data-plan-preview="true"]` to format Markdown task list items as interactive cards. Completed items (`:has(input[type="checkbox"]:checked)`) are rendered with lower opacity and a line-through effect.

---

## 4. Conflict Avoidance Strategies (Guidelines for Merging)

To minimize conflicts with upstream files, developers and agentic assistants must adhere to the following rules documented in `AGENTS.md`:

1.  **Keep files rather than deleting**: For upstream files that are unused or replaced (e.g. `packages/app/src/components/help-button.tsx`), do not delete them from the disk. Instead, stub them out (e.g., have the component `return null`) to prevent git from flagging conflicts or attempting tree-deletions on merge.
2.  **Discard non-English Translations**: During a merge, discard conflicting non-English `README.*.md` translation files and retain the WhisperCode-specific English documentation.
3.  **Run Version Sync**: Post-merge, always run `bun run script/sync-android-version.ts` to ensure build versions are synchronized.
