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
import android.content.Intent
import ai.opencode.mobilebridge.NotificationTapHandler

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
    NotificationTapHandler.handleIntent(intent)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    NotificationTapHandler.handleIntent(intent)
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
