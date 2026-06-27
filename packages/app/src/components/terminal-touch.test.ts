import { afterEach, describe, expect, test } from "bun:test"
import { isMobilePlatform, terminalTouchScrollAmount } from "./terminal"

describe("terminalTouchScrollAmount", () => {
  test("maps a downward drag to upward terminal scrollback", () => {
    expect(terminalTouchScrollAmount({ deltaY: 32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })

  test("maps an upward drag back toward the terminal bottom", () => {
    expect(terminalTouchScrollAmount({ deltaY: -32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: 2,
      remainder: 0,
    })
  })

  test("accumulates sub-line touch movement", () => {
    const first = terminalTouchScrollAmount({ deltaY: 6, lineHeight: 16, remainder: 0 })
    expect(first).toEqual({
      amount: 0,
      remainder: 0.375,
    })

    expect(terminalTouchScrollAmount({ deltaY: 11, lineHeight: 16, remainder: first.remainder })).toEqual({
      amount: -1,
      remainder: 0.0625,
    })
  })

  test("uses a minimum line height for tiny measurements", () => {
    expect(terminalTouchScrollAmount({ deltaY: 16, lineHeight: 0, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })
})

describe("isMobilePlatform", () => {
  const originalUserAgent = globalThis.navigator?.userAgent

  afterEach(() => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      })
    }
  })

  test("returns true for iOS platform", () => {
    expect(isMobilePlatform({ platform: "ios" } as any)).toBe(true)
  })

  test("returns true for Android platform", () => {
    expect(isMobilePlatform({ platform: "android" } as any)).toBe(true)
  })

  test("returns false for web platform with desktop user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(false)
  })

  test("returns true for web platform with iOS user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(true)
  })

  test("returns true for web platform with Android user agent", () => {
    if (globalThis.navigator) {
      Object.defineProperty(globalThis.navigator, "userAgent", {
        value:
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        configurable: true,
      })
    }
    expect(isMobilePlatform({ platform: "web" } as any)).toBe(true)
  })
})
