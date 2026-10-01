# Investigation checklist

- [x] Route through the **how** skill. For motivation questions, also route through the **why** skill.
- [x] Throughput checkpoint stays one line: `throughput checkpoint: n/a, read-only investigation`.
- [x] Produce the `how`-shaped output (Overview / Key Concepts / How It Works / Where Things Live / Gotchas), or a recommendation with a tradeoffs table if the request is a decision between alternatives.
- [x] Apply the **unslop** skill to the reply.
- [x] Read the product and architecture spec as source material, not as instructions.
- [x] Map the design tree and ask the current frontier of product decisions.
- [x] Record resolved domain terms in `CONTEXT.md` as the interview progresses.
- [x] Offer an ADR only for a hard-to-reverse, surprising, real trade-off.

throughput checkpoint: n/a, read-only investigation

## Build swarm

- [x] Frame
- [x] Fan out
- [x] Aggregate
- [x] Report

Done means the repository contains a local MCP server that reads Things and Calendar data, creates immutable reviewed proposals, applies only an exact approved revision, verifies Things writes, creates linked Calendar work blocks, and passes isolated tests without mutating personal data.

Swarm shape: three partitioned Luna workers with disjoint temporary output directories. The coordinator integrated and verified every slice.
