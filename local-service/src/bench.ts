/** Compare per-call Python startup with the warm worker, using a read-only tool. */
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { ManagedRuntime } from "effect"
import { handleLine } from "./main.ts"
import { LifeOSWorker, defaultConfig } from "./worker.ts"

const config = defaultConfig(homedir())
const request = JSON.stringify({ tool: "read_things_tags", arguments: { limit: 1 } })
const runs = 5
const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6

const cold: number[] = []
for (let i = 0; i < runs; i++) {
  const t = process.hrtime.bigint()
  const out = spawnSync(config.command, ["-m", "lifeos.cloud_bridge"], { cwd: config.cwd, env: config.env, input: request })
  cold.push(ms(t))
  if (i === 0) console.log("cold isError:", JSON.parse(out.stdout.toString()).isError)
}

const runtime = ManagedRuntime.make(LifeOSWorker.layer(config))
const warm: number[] = []
for (let i = 0; i < runs + 1; i++) {
  const t = process.hrtime.bigint()
  const out = await runtime.runPromise(handleLine(request))
  warm.push(ms(t))
  if (i === 0) console.log("warm isError:", out.isError)
}
await runtime.dispose()
const fmt = (xs: number[]) => xs.map((x) => x.toFixed(0)).join(", ")
console.log(`per-call python ms: ${fmt(cold)}`)
console.log(`warm worker ms (first includes start): ${fmt(warm)}`)
