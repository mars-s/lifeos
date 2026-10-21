// Synthetic stand-in for `lifeos.cloud_bridge --serve`. Never touches Things or Calendar.
import { createInterface } from "node:readline"
process.stdout.write(process.argv.includes("--not-ready") ? "Traceback: import failed\n" : '{"worker":1,"ready":"lifeos-cloud-bridge"}\n')
for await (const line of createInterface({ input: process.stdin })) {
  const { tool, arguments: args } = JSON.parse(line)
  if (args.crash) process.exit(1)
  if (args.hang) continue
  if (args.garbage) { process.stdout.write("[1,2]\n"); continue }
  await new Promise((r) => setTimeout(r, args.delay ?? 0))
  process.stdout.write(JSON.stringify({ isError: false, content: [], structuredContent: { tool, pid: process.pid, id: args.id } }) + "\n")
}
