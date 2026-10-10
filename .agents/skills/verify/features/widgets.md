# ChatGPT widgets

A user sees a Day Plan, proposal review, or brain-dump canvas inside ChatGPT after a LifeOS render tool returns structured content with an MCP Apps UI resource.

## Sub-features

- `day-plan`: the renderer points to a plan widget and accepts the exact planner output.
- `proposal-review`: the review widget exposes exact revision actions.
- `brain-dump`: the canvas widget exposes safe structured visualization content.

## How to get to it (user POV)

- In ChatGPT, ask LifeOS to render a day plan, review a proposal, or visualize a brain dump. ChatGPT calls the corresponding MCP render tool and mounts its `ui://lifeos/...` resource.

## Driving it with pytest and FastMCP Client

Preconditions:

- Run from the repository root after `uv sync --extra test`.
- These tests use FastMCP Client with an in-process service boundary, not the logged-in ChatGPT host.

- **Day plan.** Run `uv run pytest tests/test_server.py::test_day_plan_renderer_accepts_the_exact_plan_day_result tests/test_server.py::test_day_plan_renderer_exposes_a_chatgpt_component -q`. Check structured output and resource metadata.
- **Proposal card.** Run `uv run pytest tests/test_server.py::test_proposal_review_exposes_exact_revision_actions_to_chatgpt -q`. Check exact revision binding.
- **Brain-dump canvas.** Run `uv run pytest tests/test_server.py::test_brain_dump_canvas_exposes_a_safe_flexible_chatgpt_component -q`. Check resource content and output.

## Gotchas

- For the unified cloud connector, run `npm run test:mcp` and `npm run test:native`
  in `cloud-mirror/cloudflare`. The former checks exact day/week output and the
  five UI resources. The latter checks local-tool consent, transient delivery and
  absence of synthetic raw text from cloud storage. Neither uses live credentials.
- `sh scripts/verify.sh` rejects stale generated cloud and native schema contracts.

- An MCP resource test does not prove ChatGPT mounted the widget. A live host visual check remains separate.
- Never run approval or apply actions in the real account as a widget smoke test.
