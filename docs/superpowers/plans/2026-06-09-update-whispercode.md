# Update Whispercode for Opencode v2 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile and update the whispercode mobile fork to support the upstream opencode v2 UI redesign and multi-server architecture while fully preserving mobile platform integrations (push pairing, relay, notifications, speech locale, voice dictation, and haptic feedback).

**Architecture:** Merge upstream changes from `/Users/isaac/Projects/opencode`, resolve dependency renaming from `@opencode-ai/shared` to `@opencode-ai/core`, re-integrate mobile global context providers in the root application wrapper, migrate layout keys to the new path-key module, and integrate mobile settings options into the rewritten v2 settings panels.

**Tech Stack:** SolidJS, Vite, TailwindCSS, Bun

---

### Task 1: Merge Upstream Changes & Update Dependencies

**Files:**
- Modify: `packages/app/package.json`
- Modify: `packages/push-relay/package.json`
- Modify: `packages/push/package.json`

- [ ] **Step 1: Merge upstream dev branch into local dev**

Run: `git remote add upstream /Users/isaac/Projects/opencode && git fetch upstream && git merge upstream/dev --no-commit --no-ff`
Expected: Merged files from upstream, potential conflicts staged or ready to be resolved.

- [ ] **Step 2: Update workspace dependency names in packages/app/package.json**

Replace the old `@opencode-ai/shared` import with the new core dependency:
```json
"@opencode-ai/core": "workspace:*",
```
Ensure `@opencode-ai/shared` is removed from dependencies list in all package json files.

- [ ] **Step 3: Run package installation**

Run: `bun install`
Expected: Successful package install with zero lockfile conflicts.

- [ ] **Step 4: Commit Phase 1 changes**

```bash
git add packages/app/package.json
git commit -m "chore: align dependency structure with upstream core packages"
```

---

### Task 2: Reconcile Shared Dependency Imports

**Files:**
- Modify: `packages/app/src/context/push-pair.tsx`
- Modify: `packages/app/src/context/push-relay.tsx`

- [ ] **Step 1: Update imports in push-pair.tsx**

Check lines containing `@opencode-ai/shared` and change them to `@opencode-ai/core`:
```typescript
import { Sync } from "@opencode-ai/core/sync"
```

- [ ] **Step 2: Update imports in push-relay.tsx**

Update imports from:
```typescript
import { Push } from "@opencode-ai/shared/push"
```
to:
```typescript
import { Push } from "@opencode-ai/core/push"
```

- [ ] **Step 3: Run typescript verification on push contexts**

Run: `bun run --cwd packages/app typecheck`
Expected: No import resolution errors for push-pair.tsx and push-relay.tsx.

- [ ] **Step 4: Commit dependency updates**

```bash
git add packages/app/src/context/push-pair.tsx packages/app/src/context/push-relay.tsx
git commit -m "refactor: update mobile context imports to use @opencode-ai/core"
```

---

### Task 3: Restore Global Providers & App Bootstrapping

**Files:**
- Modify: `packages/app/src/app.tsx`

- [ ] **Step 1: Re-insert Push notification providers in the global Reactivity/Context tree**

Wrap the `<Layout>` element with `<PushRelayProvider>` and `<PushPairProvider>`:
```typescript
import { PushRelayProvider } from "@/context/push-relay"
import { PushPairProvider } from "@/context/push-pair"

// Inside the App component render block:
<PushRelayProvider>
  <PushPairProvider>
    <Layout />
  </PushPairProvider>
</PushRelayProvider>
```

- [ ] **Step 2: Verify app.tsx compiles cleanly**

Run: `bun run --cwd packages/app typecheck`
Expected: Success

- [ ] **Step 3: Commit the restored providers**

```bash
git add packages/app/src/app.tsx
git commit -m "feat(app): restore mobile push providers in app wrapper"
```

---

### Task 4: Reconcile Layout Context & Push Event Handling

**Files:**
- Modify: `packages/app/src/pages/layout.tsx`

- [ ] **Step 1: Migrate workspace workspaceKey references to pathKey**

Upstream replaced `workspaceKey` with `pathKey`. Update imports and logic in layout:
```typescript
import { pathKey } from "@/utils/path-key"
```

- [ ] **Step 2: Re-port push message-handling and channel listeners inside onMount**

Ensure the mobile notification routing registration block is present:
```typescript
onMount(() => {
  if (platform.pushState) {
    // Sync push pairing & relay tokens
    platform.pushState()
  }
})
```

- [ ] **Step 3: Run typescript check for layout.tsx**

Run: `bun run --cwd packages/app typecheck`
Expected: PASS

- [ ] **Step 4: Commit layout changes**

```bash
git add packages/app/src/pages/layout.tsx
git commit -m "feat(layout): migrate to pathKey and restore mobile layout push syncing"
```

---

### Task 5: Port Settings and Dialogs to v2 UI Panels

**Files:**
- Modify: `packages/app/src/components/settings-v2/general.tsx`
- Modify: `packages/app/src/components/dialog-settings.tsx`

- [ ] **Step 1: Re-integrate Voice Speech Locale options into settings-v2/general.tsx**

Inside general.tsx settings page, add the option picker for speech input:
```typescript
const [speechLocale, setSpeechLocale] = createSignal("")
// Render picker linked to platform.getSpeechLocales() and platform.setSpeechLocale()
```

- [ ] **Step 2: Restore Mobile Notification Settings tab inside dialog-settings.tsx**

Ensure the mobile notification settings block is loaded inside the new dialog categories:
```typescript
import { SettingsMobileNotifications } from "@/components/settings-mobile-notifications"

// Register tab:
{
  id: "mobile-notifications",
  label: "Mobile Notifications",
  component: SettingsMobileNotifications,
}
```

- [ ] **Step 3: Typecheck and test Settings page**

Run: `bun run --cwd packages/app typecheck`
Expected: Success

- [ ] **Step 4: Commit settings updates**

```bash
git add packages/app/src/components/settings-v2/general.tsx packages/app/src/components/dialog-settings.tsx
git commit -m "feat(settings): migrate voice and push settings to settings-v2 dialog"
```

---

### Task 6: Final Header Actions & Platform Verification

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`

- [ ] **Step 1: Re-port the platform manual refresh button**

Add the restart action button back to the header:
```typescript
<button onClick={() => platform.restart()}>Refresh</button>
```

- [ ] **Step 2: Validate entire app package compiles**

Run: `bun run typecheck`
Expected: Successful, typecheck complete with zero errors.

- [ ] **Step 3: Commit Phase 6 changes**

```bash
git add packages/app/src/components/session/session-header.tsx
git commit -m "feat(header): restore platform restart button for mobile devices"
```
