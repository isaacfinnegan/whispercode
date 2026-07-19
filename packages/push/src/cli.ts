#!/usr/bin/env node
import { pathToFileURL } from "url"
import { parse, run, type CLIIO, type CmdDependencies } from "./cmd.js"

export async function main(
  args = process.argv.slice(2),
  io: CLIIO = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  dependencies: Partial<CmdDependencies> = {},
) {
  try {
    const result = await run(args[0], parse(args), io, dependencies)
    return result && result.ok === false ? 1 : 0
  } catch {
    io.stderr.write('{"ok":false,"error":"command_failed"}\n')
    return 1
  }
}

if (import.meta.main || (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)) {
  void main().then((code) => {
    process.exitCode = code
  })
}
