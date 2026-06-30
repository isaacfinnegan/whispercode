# Terminal Button Visibility and Settings Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the terminal toggle button is visible in the session header on mobile/web/desktop, and that the `showTerminal` setting controls its visibility on all platforms.

**Architecture:** Update `session-header.tsx` to use the `settings.general.showTerminal()` setting on all platforms instead of hardcoding `true` on mobile, wrap the fallback (classic) actions' terminal toggle button in a `<Show>` conditional, and update translation descriptions to refer to the "title bar" rather than "desktop title bar".

**Tech Stack:** TypeScript, SolidJS, Bun

---

### Task 1: Update settings descriptions in translation files

**Files:**
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/uk.ts`

- [ ] **Step 1: Read translation files to locate showNavigation and showTerminal description keys**

Read: `packages/app/src/i18n/en.ts` starting from line 870 to 885.
Read: `packages/app/src/i18n/uk.ts` starting from line 765 to 780.

- [ ] **Step 2: Update the translation keys to refer to the "title bar" rather than the "desktop title bar"**

In `packages/app/src/i18n/en.ts`, update:
```typescript
  "settings.general.row.showNavigation.description": "Show the back and forward buttons in the title bar",
  "settings.general.row.showTerminal.description": "Show the terminal button in the title bar",
```

In `packages/app/src/i18n/uk.ts`, update:
```typescript
  "settings.general.row.showNavigation.description": "Показувати кнопки назад і вперед у заголовку",
  "settings.general.row.showTerminal.description": "Показувати кнопку термінала в заголовку",
```

- [ ] **Step 3: Run translation parity tests to verify correctness**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && rtk bun run --cwd packages/app test:unit -- src/i18n/parity.test.ts`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
rtk git add packages/app/src/i18n/en.ts packages/app/src/i18n/uk.ts
rtk git commit -m "i18n: generalize showNavigation and showTerminal setting descriptions"
```

---

### Task 2: Implement settings-driven terminal visibility in SessionHeader

**Files:**
- Modify: `packages/app/src/components/session/session-header.tsx`

- [ ] **Step 1: Read session-header.tsx to locate the term memo and classic terminal toggle button**

Read: `packages/app/src/components/session/session-header.tsx` lines 160-170 and 475-495.

- [ ] **Step 2: Modify the term memo to respect showTerminal setting unconditionally**

In `packages/app/src/components/session/session-header.tsx`, update:
```typescript
<<<<
  const term = createMemo(() => (isDesktopV2() ? settings.general.showTerminal() : true))
====
  const term = createMemo(() => settings.general.showTerminal())
>>>>
```

- [ ] **Step 3: Wrap the classic terminal toggle button in a Show conditional**

In `packages/app/src/components/session/session-header.tsx`, find the terminal button in the fallback (classic) actions component and wrap it:
```typescript
<<<<
                    <TooltipKeybind
                      title={language.t("command.terminal.toggle")}
                      keybind={command.keybind("terminal.toggle")}
                    >
                      <Button
                        variant="ghost"
                        class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                        onClick={toggleTerminal}
                        aria-label={language.t("command.terminal.toggle")}
                        aria-expanded={view().terminal.opened()}
                        aria-controls="terminal-panel"
                      >
                        <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                      </Button>
                    </TooltipKeybind>
====
                    <Show when={term()}>
                      <TooltipKeybind
                        title={language.t("command.terminal.toggle")}
                        keybind={command.keybind("terminal.toggle")}
                      >
                        <Button
                          variant="ghost"
                          class="group/terminal-toggle titlebar-icon w-8 h-6 p-0 box-border shrink-0"
                          onClick={toggleTerminal}
                          aria-label={language.t("command.terminal.toggle")}
                          aria-expanded={view().terminal.opened()}
                          aria-controls="terminal-panel"
                        >
                          <Icon size="small" name={view().terminal.opened() ? "terminal-active" : "terminal"} />
                        </Button>
                      </TooltipKeybind>
                    </Show>
>>>>
```

- [ ] **Step 4: Run unit tests to verify no regressions**

Run: `export PATH="/Users/isaac/.bun/bin:/Users/isaac/.local/bin:$PATH" && rtk bun run --cwd packages/app test:unit`
Expected: PASS with 0 failures

- [ ] **Step 5: Commit changes**

```bash
rtk git add packages/app/src/components/session/session-header.tsx
rtk git commit -m "feat(app): respect showTerminal setting on all platforms in session header"
```
