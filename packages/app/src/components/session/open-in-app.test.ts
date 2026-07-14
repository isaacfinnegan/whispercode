import { expect, test } from "bun:test"
import { detectOpenAppOS } from "./open-in-app"

test("treats mobile desktop OS values as unknown", () => {
  expect(detectOpenAppOS({ platform: "desktop", os: "android" } as never)).toBe("unknown")
})
