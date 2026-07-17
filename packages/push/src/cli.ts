#!/usr/bin/env node
import { pathToFileURL } from "url"
import { parse, run, type CLIIO, type CmdDependencies } from "./cmd.js"

const PTY_HOLD_FLAG = "--pty-hold"
const PTY_HOLD_MS = 20_000

type HoldInput = CLIIO["stdin"] & {
  once?(event: "close" | "end", listener: () => void): unknown
  removeListener?(event: "close" | "end", listener: () => void): unknown
}

function holdPty(input: CLIIO["stdin"]) {
  const stream = input as HoldInput
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.removeListener?.("close", finish)
      stream.removeListener?.("end", finish)
      resolve()
    }
    const timer = setTimeout(finish, PTY_HOLD_MS)
    stream.once?.("close", finish)
    stream.once?.("end", finish)
  })
}

export async function main(
  args = process.argv.slice(2),
  io: CLIIO = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
  dependencies: Partial<CmdDependencies> = {},
) {
  const hold = args.includes(PTY_HOLD_FLAG)
  const next = hold ? args.filter((arg) => arg !== PTY_HOLD_FLAG) : args
  let code: number
  try {
    const result = await run(next[0], parse(next), io, dependencies)
    code = result && result.ok === false ? 1 : 0
  } catch {
    io.stderr.write('{"ok":false,"error":"command_failed"}\n')
    code = 1
  }
  if (hold) await holdPty(io.stdin).catch(() => undefined)
  return code
}

if (import.meta.main || (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)) {
  void main().then((code) => {
    process.exitCode = code
  })
}
