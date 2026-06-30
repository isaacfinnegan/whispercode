# Design Spec: Expose Advanced Settings on Web UI for Mode Switching

## Context & Background
In OpenCode, the session modes (like **Plan mode** and **Build mode**) are governed via the active agent setting.
While the Terminal User Interface (TUI) provides simple toggling of these modes using the `Tab` key, the Web and Desktop UI controls this via an Agent dropdown selector in the prompt input area.

Currently, this selector is hidden behind a configuration flag (`settings.general.showCustomAgents`), which is disabled by default. 
To toggle this setting, the user must navigate to the **Advanced** section of the Settings menu. However, this section is completely wrapped in a `<Show when={desktop()}>` block, meaning it is hidden on the web client platform. As a result, web client users have no way to toggle the selector and manually switch modes.

## Proposed Changes
We will expose the **Advanced** settings section to all platforms in the Web/Desktop client, allowing the **Show Custom Agents** switch to be turned on regardless of whether the platform is desktop or web.

### 1. `packages/app/src/components/settings-general.tsx`
Remove the `<Show when={desktop()}>` wrapper from the `<AdvancedSection />` component so it is rendered on all client environments.

```tsx
// Before
<Show when={desktop()}>
  <AdvancedSection />
</Show>

// After
<AdvancedSection />
```

## Verification
1. Open the Web settings panel (`/settings`).
2. Verify that the **Advanced** section is visible under the **Updates** section.
3. Toggle the **Show Custom Agents** switch.
4. Verify that the agent dropdown list (`Plan`, `Build`, `Explore`, etc.) now renders at the bottom of the prompt composer input area.
