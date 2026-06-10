package com.devgriffin.whispercode

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import android.webkit.*
import android.graphics.Bitmap
import android.net.http.SslError

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val originalClient = webView.webViewClient
    if (originalClient != null) {
      webView.webViewClient = DelegatingWebViewClient(originalClient)
    }
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
