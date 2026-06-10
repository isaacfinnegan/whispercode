# Android WebView SSL Certificate Limitation Notes

This document logs the current Android connection limitations and issues encountered during the upgrade to Opencode v2, to be resolved in a future phase.

## Current Limitation: Untrusted/Self-Signed SSL Certificates on Android
When connecting the Android application to the Opencode server using `https://` (e.g., over custom ports like `8443` with self-signed SSL/TLS certificates), the connection fails with the Chromium error:
`[ERROR:net/socket/ssl_client_socket_impl.cc] handshake failed; returned -1, SSL error code 1, net_error -202 (ERR_CERT_AUTHORITY_INVALID)`

### Why this happens:
1. Modern Android WebViews block cleartext and untrusted/self-signed SSL certificate socket handshakes natively.
2. Unlike primary frame page loads, JS-initiated network requests (e.g. `fetch()`, `XMLHttpRequest`, and WebSocket handshakes) do **not** trigger the native `WebViewClient.onReceivedSslError()` callback. Thus, programmatic Java/Kotlin bypasses (`handler.proceed()`) in the WebViewClient are ineffective for app API and SSE sync traffic.

### Mitigations Implemented:
* Custom `usesCleartextTraffic="true"` and `network_security_config.xml` (trusting user-installed CA certificates) have been added to the Android target.
* Health-check checks were bypassed in the select-server dialog and onboarding view, allowing connection attempts to proceed even when the health check dot is red.

### Future Action Items:
1. **Automate Let's Encrypt / Tailscale Certificate Integration:** Configure the mobile platform to fetch or check for valid Tailscale HTTPS certificates (`tailscale cert`) so that the WebView trusts the domain natively without manual certificate installation.
2. **Native Fetch Bridge:** Implement a Tauri native plugin bridge for HTTP requests (like `@tauri-apps/plugin-http`) that redirects frontend `fetch()` requests through native Rust `reqwest` clients, bypassing WebView SSL verification and CORS policies entirely.
