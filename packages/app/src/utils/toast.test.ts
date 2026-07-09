import { beforeAll, describe, expect, mock, test } from "bun:test"
import { showToast, setV2Toast } from "./toast"

// @ts-ignore
globalThis.React = {
  createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }),
} as any

const showLegacyToastMock = mock((_options: any) => 0)
const showToastV2Mock = mock((_options: any) => 0)

beforeAll(() => {
  mock.module("@opencode-ai/ui/toast", () => ({
    Toast: { Region: () => null },
    showToast: showLegacyToastMock,
  }))

  mock.module("@opencode-ai/ui/v2/toast-v2", () => ({
    ToastV2: { Region: () => null },
    showToastV2: showToastV2Mock,
  }))
})

describe("toast wrapper utility", () => {
  test("legacy toast: general options passed through", () => {
    setV2Toast(false)
    showToast({ title: "hello", variant: "success" })
    expect(showLegacyToastMock).toHaveBeenCalledWith({ title: "hello", variant: "success" })
  })

  test("legacy toast: error variant forces auto-dismiss (persistent: false, duration: 5000)", () => {
    setV2Toast(false)
    showToast({ title: "error occurred", variant: "error" })
    expect(showLegacyToastMock).toHaveBeenCalledWith({
      title: "error occurred",
      variant: "error",
      persistent: false,
      duration: 5000,
    })
  })

  test("v2 toast: general options passed through", () => {
    setV2Toast(true)
    showToast({ title: "hello", variant: "success" })
    expect(showToastV2Mock).toHaveBeenCalled()
  })

  test("v2 toast: error variant forces auto-dismiss (persistent: false, duration: 5000)", () => {
    setV2Toast(true)
    showToast({ title: "error occurred", variant: "error" })
    const lastCall = showToastV2Mock.mock.calls[showToastV2Mock.mock.calls.length - 1]
    expect(lastCall[0]).toMatchObject({
      title: "error occurred",
      variant: "error",
      persistent: false,
      duration: 5000,
    })
  })
})
