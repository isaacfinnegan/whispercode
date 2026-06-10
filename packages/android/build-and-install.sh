#!/bin/bash
set -euo pipefail

# Android build-and-install script for WhisperCode
# Usage: ./build-and-install.sh
# NOTE: To keep the APK size minimal:
#   1. Always build with target-specific splitting (--split-per-abi) to avoid bundling multiple architectures.
#   2. Keep Rust debug symbol stripping configured in `packages/android/src-tauri/Cargo.toml` under `[profile.dev]`.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Environment setup
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/30.0.14904198"
export PATH="/Users/isaac/.bun/bin:/Users/isaac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:$PATH"

# Verify prerequisites
if [ ! -d "$JAVA_HOME" ]; then
  echo "ERROR: JDK not found at $JAVA_HOME"
  exit 1
fi

echo "==> Building frontend..."
bun run build

echo "==> Building APK..."
bun run tauri android build --apk --debug --target aarch64 --split-per-abi

APK="$SCRIPT_DIR/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: APK not found at $APK"
  exit 1
fi

echo "==> Pushing to pixel-10-pro-fold via Tailscale..."
/usr/local/bin/tailscale file cp "$APK" "pixel-10-pro-fold:"
echo "==> Done! Pushed to pixel-10-pro-fold via Tailscale."
