// @ts-expect-error Bun test types are excluded from the production tsconfig.
import { expect, test } from "bun:test"
import { execFile, spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const installer = new URL("../script/install-cli.sh", import.meta.url).pathname
const execute = promisify(execFile)

const executable = async (path: string, version: string, exit = 0) => {
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${version}'\nexit ${exit}\n`)
  await chmod(path, 0o755)
}

const install = (source: string, destination: string) =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("bash", [installer, source, destination], { stdio: "ignore" })
    child.once("error", reject)
    child.once("close", (code) => resolve(code ?? -1))
  })

test("a failed candidate leaves the installed CLI unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whispercode-cli-install-"))
  const source = join(dir, "candidate")
  const destination = join(dir, "bin", "opencode")
  await mkdir(join(dir, "bin"))
  await executable(source, "broken", 1)
  await executable(destination, "working")

  expect(await install(source, destination)).not.toBe(0)
  expect((await execute(destination, ["--version"])).stdout).toBe("working\n")
  expect(await readFile(destination, "utf8")).toContain("working")
})

test("a validated candidate atomically replaces the installed CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "whispercode-cli-install-"))
  const source = join(dir, "candidate")
  const destination = join(dir, "bin", "opencode")
  await mkdir(join(dir, "bin"))
  await executable(source, "candidate")
  await executable(destination, "working")

  expect(await install(source, destination)).toBe(0)
  expect((await execute(destination, ["--version"])).stdout).toBe("candidate\n")
  expect((await readdir(join(dir, "bin"))).filter((file) => file.startsWith(".opencode."))).toEqual([])
})
