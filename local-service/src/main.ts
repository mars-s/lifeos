/**
 * LifeOS local service: a persistent stdio process for the Mac agent.
 *
 * Protocol: one JSON object `{"tool","arguments"}` per stdin line, one tool result per
 * stdout line, in order. The Swift agent can keep this process open instead of starting
 * Python for every call. Tool names are checked against the shipped contract first.
 *
 * On start the service writes READY_LINE once. The agent sends nothing before it, so a
 * service that cannot start is detected without any request being lost or half-run.
 */
import { createInterface } from "node:readline"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { Effect, ManagedRuntime } from "effect"
import { LifeOSWorker, MAX_BYTES, defaultConfig, failure, type ToolResult } from "./worker.ts"

const contractPath = new URL("../../cloud-mirror/cloudflare/local-tool-contracts.json", import.meta.url)
export const TOOL_NAMES: ReadonlySet<string> = new Set(
  (JSON.parse(readFileSync(contractPath, "utf8")) as Array<{ name: string }>).map((tool) => tool.name),
)

const REJECTED = failure("Local tools are disabled or busy. No invocation was sent.")
export const READY_LINE = '{"protocol":1,"ready":"lifeos-local-service"}'

export const handleLine = (line: string): Effect.Effect<ToolResult, never, LifeOSWorker> =>
  Effect.gen(function* () {
    if (Buffer.byteLength(line) > MAX_BYTES) return REJECTED
    let request: unknown
    try { request = JSON.parse(line) } catch { return REJECTED }
    if (typeof request !== "object" || request === null || Array.isArray(request)) return REJECTED
    const { tool, arguments: args, ...rest } = request as Record<string, unknown>
    if (Object.keys(rest).length || typeof tool !== "string" || !TOOL_NAMES.has(tool)) return REJECTED
    if (typeof args !== "object" || args === null || Array.isArray(args)) return REJECTED
    const worker = yield* LifeOSWorker
    return yield* worker.invoke(tool, args as Record<string, unknown>)
  })

if (import.meta.main) {
  // stdout is the reply channel. Route every incidental log to stderr, which the agent discards.
  const reply = process.stdout.write.bind(process.stdout)
  for (const level of ["log", "info", "warn", "debug", "trace"] as const) console[level] = console.error
  const runtime = ManagedRuntime.make(LifeOSWorker.layer(defaultConfig(homedir())))
  await runtime.runPromise(Effect.asVoid(LifeOSWorker))
  reply(READY_LINE + "\n")
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    const result = await runtime.runPromise(handleLine(line))
    reply(JSON.stringify(result) + "\n")
  }
  await runtime.dispose()
}
