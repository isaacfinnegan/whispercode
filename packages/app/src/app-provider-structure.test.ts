import { expect, test } from "bun:test"

test("mounts one shared settings provider", async () => {
  const source = await Bun.file(new URL("./app.tsx", import.meta.url)).text()
  expect(source.match(/<SettingsProvider>/g)).toHaveLength(1)
})
