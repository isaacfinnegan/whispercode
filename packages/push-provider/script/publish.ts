#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { readdir, rm } from "node:fs/promises"
import { fileURLToPath } from "url"
import { rewrite } from "../src/pack"

const dir = fileURLToPath(new URL("..", import.meta.url))

process.chdir(dir)

const raw = await import("../package.json").then((mod) => mod.default)
const text = JSON.stringify(raw, null, 2) + "\n"

try {
  await $`bun tsc`
  await Bun.write("package.json", JSON.stringify(rewrite(raw), null, 2) + "\n")
  const list = await readdir(".")
  await Promise.all(list.filter((item) => item.endsWith(".tgz")).map((item) => rm(item, { force: true })))
  await $`bun pm pack`
  await $`npm publish *.tgz --tag ${Script.channel} --access public`
} finally {
  await Bun.write("package.json", text)
}
