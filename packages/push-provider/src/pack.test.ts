import { describe, expect, test } from "bun:test"
import pkg from "../package.json"
import { rewrite } from "./pack"

describe("pack", () => {
  test("rewrites source exports to compiled files", () => {
    const next = rewrite(pkg)

    expect(next.exports).toEqual({
      ".": {
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    })
    expect(pkg.exports).toEqual({
      ".": "./src/index.ts",
    })
  })
})
