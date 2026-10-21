import { Duration, Effect, ManagedRuntime } from "effect"
import { afterEach, expect, test } from "vitest"
import { handleLine } from "../src/main.ts"
import { LifeOSWorker, NOT_STARTED, UNCERTAIN } from "../src/worker.ts"

const fake = new URL("./fake-worker.mjs", import.meta.url).pathname
const runtime = (timeout = Duration.seconds(5)) =>
  ManagedRuntime.make(LifeOSWorker.layer({ command: process.execPath, args: [fake], cwd: "/", env: {}, timeout }))
let current: ReturnType<typeof runtime> | undefined
afterEach(async () => { await current?.dispose() })

const call = (line: object | string) =>
  current!.runPromise(handleLine(typeof line === "string" ? line : JSON.stringify(line)))
const pid = (r: any) => r.structuredContent.pid

test("rejects tools outside the shipped contract before reaching the worker", async () => {
  current = runtime()
  for (const bad of ['{"tool":"execute","arguments":{}}', '{"tool":"get_brain_dump","arguments":[]}',
    '{"tool":"get_brain_dump","arguments":{},"owner":"x"}', "not json"]) {
    expect((await call(bad)).isError).toBe(true)
  }
})

test("reuses one warm worker and keeps calls strictly ordered", async () => {
  current = runtime()
  const results = await Promise.all([3, 2, 1].map((id) =>
    call({ tool: "get_brain_dump", arguments: { id, delay: id * 20 } })))
  expect(results.map((r: any) => r.structuredContent.id)).toEqual([3, 2, 1])
  expect(new Set(results.map(pid)).size).toBe(1)
})

test("a crash returns the uncertain-state message once and the next call gets a fresh worker", async () => {
  current = runtime()
  const before = pid(await call({ tool: "get_brain_dump", arguments: {} }))
  expect(await call({ tool: "get_brain_dump", arguments: { crash: true } })).toEqual(UNCERTAIN)
  expect(pid(await call({ tool: "get_brain_dump", arguments: {} }))).not.toBe(before)
})

test("a hung worker is replaced after the time budget", async () => {
  current = runtime(Duration.millis(200))
  const before = pid(await call({ tool: "get_brain_dump", arguments: {} }))
  expect(await call({ tool: "get_brain_dump", arguments: { hang: true } })).toEqual(UNCERTAIN)
  expect(pid(await call({ tool: "get_brain_dump", arguments: {} }))).not.toBe(before)
})

test("a missing interpreter is reported as not sent and does not crash the service", async () => {
  current = ManagedRuntime.make(LifeOSWorker.layer({
    command: "/nonexistent/python", args: [], cwd: "/", env: {}, timeout: Duration.seconds(5),
  }))
  expect(await call({ tool: "get_brain_dump", arguments: {} })).toEqual(NOT_STARTED)
  expect(await call({ tool: "get_brain_dump", arguments: {} })).toEqual(NOT_STARTED)
})

test("a worker that fails before its ready line is never sent a request", async () => {
  current = ManagedRuntime.make(LifeOSWorker.layer({
    command: process.execPath, args: [fake, "--not-ready"], cwd: "/", env: {}, timeout: Duration.seconds(5),
  }))
  expect(await call({ tool: "get_brain_dump", arguments: { id: 1 } })).toEqual(NOT_STARTED)
})

test("a malformed worker reply is never passed through", async () => {
  current = runtime()
  expect(await call({ tool: "get_brain_dump", arguments: { garbage: true } })).toEqual(UNCERTAIN)
  expect((await call({ tool: "get_brain_dump", arguments: {} })).isError).toBe(false)
})
