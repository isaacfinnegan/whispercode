# Fix Safe Area Double Padding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the double-padding and blank status bar spacing issues in the application on iOS and Android when using the new layout system, ensuring consistent single padding across both legacy and new layouts.

**Architecture:** We will apply safe area padding to the `#root` element globally via `index.css`. The iOS app WebView container will be updated to ignore SwiftUI safe areas completely, allowing the WebView viewport to fill the entire screen while relying on the CSS `env(safe-area-inset-top)` for insets. The inline styles applying redundant safe-area paddings in `packages/android/index.html` and `packages/app/src/pages/layout-new.tsx` will be removed.

**Tech Stack:** SolidJS, CSS (Tailwind), Swift (SwiftUI), Bun

---

### Task 1: Add Global Safe Area Styling in CSS

**Files:**
- Modify: `packages/app/src/index.css:20-27`

- [ ] **Step 1: Check existing CSS around `#root` styling**

Run: `git diff HEAD packages/app/src/index.css` (read-only inspect)

- [ ] **Step 2: Add safe-area padding to `#root`**

Modify `packages/app/src/index.css` to add the padding rule for `#root`:

```css
@media (display-mode: standalone) {
  /* WebKit excludes safe-area insets from dvh in installed apps. */
  #root {
    height: 100vh;
  }
}

#root {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
```

- [ ] **Step 3: Verify no typecheck or build regression in app package**

Run: `bun run --cwd packages/app typecheck`
Expected: Success with no typescript errors.

- [ ] **Step 4: Commit the CSS changes**

Run:
```bash
rtk git add packages/app/src/index.css
rtk git commit -m "style(app): add global safe-area padding to #root"
```

---

### Task 2: Remove redundant inline style from Android HTML entrypoint

**Files:**
- Modify: `packages/android/index.html:20-25`

- [ ] **Step 1: Check existing style on `#root` in Android index.html**

Review the exact lines around `#root` in `packages/android/index.html`:
```html
    <div
      id="root"
      class="flex flex-col h-dvh"
      style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)"
    ></div>
```

- [ ] **Step 2: Remove style attribute**

Update `packages/android/index.html` to remove `style` completely:
```html
    <div id="root" class="flex flex-col h-dvh"></div>
```

- [ ] **Step 3: Verify typecheck in android package**

Run: `bun run --cwd packages/android typecheck`
Expected: Success with no typescript errors.

- [ ] **Step 4: Commit index.html changes**

Run:
```bash
rtk git add packages/android/index.html
rtk git commit -m "refactor(android): remove redundant inline safe-area style from index.html"
```

---

### Task 3: Remove redundant style padding from NewLayout

**Files:**
- Modify: `packages/app/src/pages/layout-new.tsx:27-34`

- [ ] **Step 1: Read layout-new.tsx around line 30**

Inspect the code:
```tsx
  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
```

- [ ] **Step 2: Remove the inline style attribute**

Update `packages/app/src/pages/layout-new.tsx` to:
```tsx
  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
    >
```

- [ ] **Step 3: Verify typescript safety**

Run: `bun run --cwd packages/app typecheck`
Expected: Success.

- [ ] **Step 4: Commit layout changes**

Run:
```bash
rtk git add packages/app/src/pages/layout-new.tsx
rtk git commit -m "refactor(app): remove safe-area styling from NewLayout component"
```

---

### Task 4: Configure iOS app to ignore all safe areas

**Files:**
- Modify: `packages/ios/WhisperCode/WhisperCode/App/ContentView.swift:3-8`

- [ ] **Step 1: Review ContentView.swift**

Inspect the current file contents:
```swift
struct ContentView: View {
  var body: some View {
    OpenCodeWebView()
      .ignoresSafeArea(.all, edges: .bottom)
  }
}
```

- [ ] **Step 2: Ignore all safe area edges**

Update `packages/ios/WhisperCode/WhisperCode/App/ContentView.swift` to ignore safe areas on all edges:
```swift
struct ContentView: View {
  var body: some View {
    OpenCodeWebView()
      .ignoresSafeArea(edges: .all)
  }
}
```

- [ ] **Step 3: Commit the SwiftUI changes**

Run:
```bash
rtk git add packages/ios/WhisperCode/WhisperCode/App/ContentView.swift
rtk git commit -m "fix(ios): allow webview to expand behind notch and status bar"
```

---

### Task 5: Formatting and General Verification

**Files:**
- None (verify workspace)

- [ ] **Step 1: Run Prettier to match code standards**

Run: `bunx prettier --write packages/app/src/index.css packages/android/index.html packages/app/src/pages/layout-new.tsx`
Expected: Formatting matches repository specifications.

- [ ] **Step 2: Run all workspace typechecks**

Run: `bun run --cwd packages/app typecheck && bun run --cwd packages/android typecheck`
Expected: Success.

- [ ] **Step 3: Check git status and diffs**

Run: `rtk git status`
Expected: Clean working tree (if all commits are completed).

- [ ] **Step 4: final checkin**

Verify all files were correctly formatted and committed.

---

### Task 6: Prepare Upstream Patch

**Files:**
- Create: `upstream-safe-area.patch`

- [ ] **Step 1: Generate upstream-compatible patch for packages/app**

Since `packages/app` is the shared workspace package used upstream (while `packages/android` and `packages/ios` are unique to our mobile fork), we will create a clean patch of only the shared web app changes.

Run: `git diff origin/dev -- packages/app/src/index.css packages/app/src/pages/layout-new.tsx > upstream-safe-area.patch`

- [ ] **Step 2: Verify patch contents**

Verify the generated patch matches the expected upstream layout patch:
```diff
diff --git a/packages/app/src/index.css b/packages/app/src/index.css
index ... ... 100644
--- a/packages/app/src/index.css
+++ b/packages/app/src/index.css
@@ -23,6 +23,11 @@ @media (display-mode: standalone) {
   }
 }
 
+#root {
+  padding-top: env(safe-area-inset-top, 0px);
+  padding-bottom: env(safe-area-inset-bottom, 0px);
+}
+
 @layer components {
   [data-component="getting-started"] {
     container-type: inline-size;
diff --git a/packages/app/src/pages/layout-new.tsx b/packages/app/src/pages/layout-new.tsx
index ... ... 100644
--- a/packages/app/src/pages/layout-new.tsx
+++ b/packages/app/src/pages/layout-new.tsx
@@ -27,10 +27,6 @@ export default function NewLayout(props: ParentProps) {
   return (
     <div
       class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
-      style={{
-        "padding-top": "env(safe-area-inset-top, 0px)",
-        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
-      }}
     >
       <Titlebar update={update} />
       <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
```

- [ ] **Step 3: Document patch location**

Inform the user that `upstream-safe-area.patch` is ready and can be submitted/applied to the upstream `sst/opencode` repository.

