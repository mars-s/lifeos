# Source preservation, October 1, 2026

The original LifeOS checkout had no commits or configured remote. No LifeOS repository was found in the authenticated mars-s GitHub repository list. A consolidated source checkout was prepared at `/Users/avi/Developer/projects/lifeos` for the private `mars-s/lifeos` repository.

## Included

- Original LifeOS MCP source, proposal and receipt logic, brain-dump capture, planning UI, tests, EventKit bridge, plugin definitions, verification skill, CI and documentation.
- `cloud-mirror/`: complete companion source, Mac reader and journal, Cloudflare Worker/D1/OAuth code, setup tools, tests, lockfiles, deployment notes, supported-field matrix, historical Site and Railway implementations and synthetic fixtures.
- A proposed native Mac agent and cloud-write design, with current verification distinguished from future work.

## Excluded

Credentials, environment files, personal task databases, Mac receipt journals, runtime configuration under ready-readonly, dependency installations, build outputs, deployment archives, tool session state and generated verification artifacts are excluded. The unrelated bundled Impeccable tooling is not copied. Production OAuth grants and D1 task contents remain in their existing services. This repository is a source backup, not a backup of those live databases or credentials.

The two existing source directories and their launchd services remain in place. Moving the running helper requires an explicit migration that preserves its sequence, pending uploads and receipt journal. Starting a fresh journal against the current cloud stream is not safe.

## Preservation checks

Source comparison found only the intentionally changed repository README, ignore rules and Ruff component exclusion; source implementation files were copied unchanged. Ruff excludes the independent companion so its different lint conventions do not break the original CI workflow.

The existing LifeOS lint and Python suite passed, with its live integration test skipped. The copied companion passed74 Python tests after installing its locked Wrangler dependencies, TypeScript checking,7 MCP/OAuth tests and9 Worker snapshot tests. No live task mutation or production deployment was performed for repository preservation. Gitleaks8.30.1 scanned both the collected source and the exact staged diff with full redaction and found no leaks. Runtime directories, dependency trees and database files are excluded from the staged files.

GitHub publication should remain private. Existing third-party license and attribution files are retained. The original Things adapter reads its private local database through things-py, but the newer cloud reader uses supported public automation. The native replacement should follow the latter approach.

## Current verified connection

The LifeOS Cloud Mirror Reader plugin completed GitHub OAuth as mars-s. Both the supported ChatGPT tool test and the existing dot assistant reported59 records, sequence29 and last-sync time `2026-10-01T03:54:22.120837+00:00`. No live writes were performed. Credential rotation after the earlier browser observation remains an owner secure-entry step, as described in the OAuth progress notes.
