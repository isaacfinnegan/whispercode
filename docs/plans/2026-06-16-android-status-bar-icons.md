# Android Status Bar Icons Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Android status bar icons regression where icons appear white on a white background (light mode) by dynamically adjusting the status bar icon styling based on the WebView's theme.

**Architecture:** Use a background polling loop (`themePoller`) in `MainActivity.kt` that queries the WebView's root element for the `data-color-scheme` attribute. If it's dark, set status bar icons to light; otherwise, set them to dark using `WindowInsetsControllerCompat`. Integrate this with the edge-to-edge layout framework and restore the custom `DelegatingWebViewClient` that bypasses SSL certificate issues for local development.

**Tech Stack:** Kotlin, Android SDK, Tauri Mobile (Wry), WindowInsetsControllerCompat.

---

### Task 1: Update Gitignore to track MainActivity.kt

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Add exception pattern for MainActivity.kt in `.gitignore`**

Add the tracking rule to `.gitignore` under the local dev files section:

```git
!packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt
```

- [ ] **Step 2: Verify git status tracks the file**

Run: `git status` or `git status --ignored`
Expected: `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt` should no longer be ignored and should appear as modified/untracked.

- [ ] **Step 3: Commit the .gitignore modification**

Run:

```bash
git add .gitignore
git commit -m "chore(android): un-ignore MainActivity.kt to track custom status bar changes"
```

---

### Task 2: Implement Dynamic Status Bar Icons and SSL Bypass in MainActivity.kt

**Files:**

- Modify: `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt`

- [ ] **Step 1: Write custom MainActivity implementation**

Replace the contents of `packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt` with the following Kotlin code:

```kotlin
package com.devgriffin.whispercode

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.*
import android.graphics.Bitmap
import android.net.http.SslError
import androidx.core.view.WindowInsetsControllerCompat
import android.graphics.Color
import android.os.Handler
import android.os.Looper

class MainActivity : TauriActivity() {
  private val handler = Handler(Looper.getMainLooper())
  private var currentWebView: WebView? = null

  private val themePoller = object : Runnable {
    override fun run() {
      currentWebView?.let { webView ->
        webView.evaluateJavascript("document.documentElement.getAttribute('data-color-scheme')") { value ->
          val isDark = value != null && value.contains("dark")
          updateSystemBars(isDark)
        }
      }
      handler.postDelayed(this, 500)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
    currentWebView = webView

    val originalClient = webView.webViewClient
    if (originalClient != null) {
      webView.webViewClient = DelegatingWebViewClient(originalClient)
    }

    handler.post(themePoller)
  }

  override fun onDestroy() {
    handler.removeCallbacks(themePoller)
    super.onDestroy()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) {
      themePoller.run()
    }
  }

  private fun updateSystemBars(isNightMode: Boolean) {
    val window = this.window
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = !isNightMode
  }
}

class DelegatingWebViewClient(private val delegate: WebViewClient) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        return delegate.shouldInterceptRequest(view, request)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return delegate.shouldOverrideUrlLoading(view, request)
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        delegate.onPageStarted(view, url, favicon)
    }

    override fun onPageFinished(view: WebView, url: String) {
        delegate.onPageFinished(view, url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        delegate.onReceivedError(view, request, error)
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.proceed()
    }
}
```

- [ ] **Step 2: Verify compilation of the Android package**

If Java (JDK 21) is available, run the following command to compile the Kotlin source code:

Run: `./gradlew compileDebugKotlin` (in directory `packages/android/src-tauri/gen/android/`)
Expected: Compilation completes successfully with `BUILD SUCCESSFUL`.

If Java is not available on the local machine, perform a manual code inspection to verify correct package declaration, import statements, brackets, and class naming.

- [ ] **Step 3: Commit the MainActivity changes**

Run:

```bash
git add packages/android/src-tauri/gen/android/app/src/main/java/com/devgriffin/whispercode/MainActivity.kt
git commit -m "fix(android): resolve status bar light/dark icons dynamically"
```
