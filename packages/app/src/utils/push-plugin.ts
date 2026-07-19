// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to generate the install/pair commands
// for the fork's host-side push plugin. Keep this aligned with packages/push package naming.

import info from "../../../push/package.json"

const pkg = info.name
const spec = pkg
const bin = "opencode-push"
export const PUSH_HOST_COMMAND_FAILED = '{"ok":false,"error":"push_host_command_failed"}'
const hold = String.raw`
const { spawn } = require("node:child_process")
const argv = JSON.parse(process.argv[1])
const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" })
const failure = ${JSON.stringify(`${PUSH_HOST_COMMAND_FAILED}\n`)}
let timer
let settled = false
let stopping = false
const stop = (signal) => {
  clearTimeout(timer)
  if (child.exitCode !== null || child.signalCode !== null) process.exit(1)
  if (stopping) {
    try { child.kill("SIGKILL") } catch {}
    return
  }
  stopping = true
  try { child.kill(signal) } catch { process.exit(1) }
  setTimeout(() => {
    try { child.kill("SIGKILL") } catch {}
  }, 1_000).unref()
}
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.once(signal, () => stop(signal))
const finish = (code) => {
  if (stopping) process.exit(code)
  if (settled) return
  settled = true
  process.exitCode = code
  timer = setTimeout(() => {}, 20_000)
}
const fail = () => {
  if (settled) return
  process.stdout.write(failure)
  finish(1)
}
child.once("error", fail)
child.once("close", (code, signal) => finish(code ?? (signal ? 1 : 0)))
`.trim()

type Command = { command: string; args: string[] }

function relayArg(relay?: string) {
  return relay ? ` --relay ${relay}` : ""
}

export function installPrompt(value = installPush()) {
  return `Run this exact command on the machine hosting OpenCode and report whether it succeeded: ${value}`
}

function name(value: string) {
  const idx = value.lastIndexOf("@")
  if (idx > 0) return value.slice(0, idx)
  return value
}

export function hasPush(list?: string[]) {
  return (list ?? []).some((item) => name(item) === pkg)
}

export function hasPushSpec(list?: string[]) {
  return hasPush(list)
}

export function addPush(list?: string[]) {
  const next = (list ?? []).filter((item) => name(item) !== pkg)
  next.push(spec)
  return next
}

export function dropPush(list?: string[]) {
  return (list ?? []).filter((item) => item !== spec && name(item) !== pkg)
}

export function runPush(args: string[], tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") return { command: "bunx", args: [spec, ...args] }
  return {
    command: "npx",
    args: ["--yes", "--prefix", ".", `--package=${spec}`, bin, ...args],
  }
}

export function holdPush(child: Command): Command {
  return {
    command: "node",
    args: ["-e", hold, JSON.stringify([child.command, ...child.args])],
  }
}

export function runPushTransport(args: string[], tool: "npx" | "bunx" = "npx") {
  return holdPush(runPush(args, tool))
}

export function installPush(tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") return `bunx ${spec} install`
  return `npx --yes --prefix . --package=${spec} ${bin} install`
}

export function installPair(token: string, relay?: string, tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") {
    return `bunx ${spec} install --pair ${token}${relayArg(relay)}`
  }
  return `npx --yes --prefix . --package=${spec} ${bin} install --pair ${token}${relayArg(relay)}`
}

export function pairPush(token: string, relay?: string, tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") {
    return `bunx ${spec} pair --pair ${token}${relayArg(relay)}`
  }
  return `npx --yes --prefix . --package=${spec} ${bin} pair --pair ${token}${relayArg(relay)}`
}

export const PushPlugin = {
  pkg,
  spec,
  bin,
}
