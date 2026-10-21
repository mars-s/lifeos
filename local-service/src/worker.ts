/**
 * A warm Python LifeOS worker supervised by Effect.
 *
 * The worker is `python -m lifeos.cloud_bridge --serve`: one JSON request per line in,
 * one JSON reply per line out, with the same allowlist, grant and privacy rules as the
 * per-call bridge. This module keeps it alive, serialises calls (Things and Calendar
 * writes must never overlap), enforces the 120 s budget, and restarts it after a crash
 * or timeout. Raw arguments and results never reach logs.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { Context, Data, Duration, Effect, Layer, Semaphore } from "effect"

export const MAX_BYTES = 256 * 1024

export type ToolResult = {
  readonly content: ReadonlyArray<unknown>
  readonly isError: boolean
  readonly structuredContent?: unknown
  readonly _meta?: unknown
}

export class WorkerFailure extends Data.TaggedError("WorkerFailure")<{ readonly reason: string }> {}
export class WorkerNotStarted extends Data.TaggedError("WorkerNotStarted")<{}> {}

export const failure = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] })
export const UNCERTAIN = failure(
  "Local invocation could not finish. Check saved capture or proposal state before retrying a write.",
)
export const NOT_STARTED = failure("Local tools could not start. No invocation was sent.")
export const WORKER_READY = '{"worker":1,"ready":"lifeos-cloud-bridge"}'

export type WorkerConfig = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env: Record<string, string>
  readonly timeout: Duration.Input
}

export const defaultConfig = (home: string): WorkerConfig => {
  const project = `${home}/Developer/projects/lifeos`
  return {
    command: `${project}/.venv/bin/python`,
    args: ["-m", "lifeos.cloud_bridge", "--serve"],
    cwd: project,
    // Same minimal environment as the Swift bridge: no Keychain key, cloud credentials or Python paths.
    env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", HOME: home, PYTHONUNBUFFERED: "1", PYTHONNOUSERSITE: "1" },
    timeout: Duration.seconds(120),
  }
}

type Live = {
  readonly child: ChildProcessByStdio<Writable, Readable, null>
  /** True once the worker printed WORKER_READY; false if it died or misbehaved first. */
  readonly ready: Promise<boolean>
  /** Resolves with the next reply line, or rejects if the worker dies or a reply is oversized. */
  readonly next: () => Promise<string>
  dead: boolean
}

const start = (config: WorkerConfig): Live => {
  const child = spawn(config.command, [...config.args], { cwd: config.cwd, env: config.env, stdio: ["pipe", "pipe", "ignore"] })
  let buffer = Buffer.alloc(0)
  const ready: string[] = []
  let waiter: { resolve: (line: string) => void; reject: (e: Error) => void } | undefined
  let settleReady: (ok: boolean) => void = () => {}
  let readySeen = false
  const live: Live = {
    child,
    dead: false,
    ready: new Promise<boolean>((resolve) => { settleReady = resolve }),
    next: () => new Promise((resolve, reject) => {
      const line = ready.shift()
      if (line !== undefined) return resolve(line)
      if (live.dead) return reject(new Error("worker exited"))
      waiter = { resolve, reject }
    }),
  }
  const die = () => {
    live.dead = true
    settleReady(false)
    waiter?.reject(new Error("worker exited"))
    waiter = undefined
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
  }
  // Without these listeners a missing interpreter or a closed pipe would crash the service.
  child.on("error", die)
  child.on("exit", die)
  child.stdin.on("error", die)
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    let newline: number
    while ((newline = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, newline).toString("utf8")
      buffer = buffer.subarray(newline + 1)
      if (!readySeen) {
        readySeen = true
        if (line === WORKER_READY) { settleReady(true); continue }
        die(); return
      }
      if (waiter) { const w = waiter; waiter = undefined; w.resolve(line) } else ready.push(line)
    }
    if (buffer.length > MAX_BYTES * 2) die() // the worker caps replies, so this is a broken worker
  })
  return live
}

const stop = (live: Live | undefined) => {
  if (live && live.child.exitCode === null) {
    live.dead = true
    live.child.kill("SIGTERM")
    // A worker mid-write may ignore SIGTERM; make sure it cannot linger.
    setTimeout(() => { if (live.child.exitCode === null) live.child.kill("SIGKILL") }, 3000).unref()
  }
}

const isToolResult = (value: unknown): value is ToolResult =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Array.isArray((value as ToolResult).content) && typeof (value as ToolResult).isError === "boolean"

export class LifeOSWorker extends Context.Service<LifeOSWorker, {
  readonly invoke: (tool: string, args: Record<string, unknown>) => Effect.Effect<ToolResult>
}>()("lifeos/LifeOSWorker") {
  static layer = (config: WorkerConfig) =>
    Layer.effect(LifeOSWorker, Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      let live: Live | undefined
      yield* Effect.addFinalizer(() => Effect.sync(() => stop(live)))
      // Warm Python while the first request is still on its way.
      live = start(config)

      // Nothing is written until the worker has proved it imported LifeOS, so a broken
      // environment is reported as "not sent" rather than as an uncertain write.
      const ensureReady = Effect.gen(function* () {
        if (!live || live.dead || live.child.exitCode !== null) live = start(config)
        const current = live
        const ok = yield* Effect.promise(() => current.ready)
        if (!ok) return yield* new WorkerNotStarted()
        return current
      })

      const roundTrip = (current: Live, line: string) =>
        Effect.tryPromise({
          try: async () => {
            current.child.stdin.write(line)
            return await current.next()
          },
          catch: () => new WorkerFailure({ reason: "io" }),
        })

      const invoke = (tool: string, args: Record<string, unknown>) =>
        Effect.gen(function* () {
          const line = JSON.stringify({ tool, arguments: args }) + "\n"
          if (Buffer.byteLength(line) > MAX_BYTES + 1) return failure("Local request exceeds the size budget.")
          const current = yield* ensureReady.pipe(
            Effect.timeout(Duration.seconds(30)),
            Effect.catchCause(() => Effect.sync(() => { stop(live); live = undefined })),
          )
          if (!current) return NOT_STARTED
          const reply = yield* roundTrip(current, line).pipe(
            Effect.timeout(config.timeout),
            Effect.mapError(() => new WorkerFailure({ reason: "timeout-or-io" })),
          )
          if (Buffer.byteLength(reply) > MAX_BYTES) return failure("Local result exceeds the response budget. Use a smaller range or page.")
          const parsed = yield* Effect.try({ try: () => JSON.parse(reply) as unknown, catch: () => new WorkerFailure({ reason: "parse" }) })
          if (!isToolResult(parsed)) return yield* new WorkerFailure({ reason: "shape" })
          return parsed
        }).pipe(
          // A stuck or crashed worker may hold half a reply. Replace it; never replay the call.
          Effect.catchCause(() => Effect.sync(() => { stop(live); live = undefined; return UNCERTAIN })),
          lock.withPermits(1),
        )

      return { invoke }
    }))
}
