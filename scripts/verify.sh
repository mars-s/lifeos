#!/bin/sh
set -eu

uv run ruff check .
uv run pytest -q
uv run python .agents/skills/verify/scripts/verify_lifeos.py run
