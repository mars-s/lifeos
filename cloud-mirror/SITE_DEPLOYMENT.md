# Private sample Site deployment evidence

## Current mirror-capable version 2

Private deployment succeeded September 30, 2026, **11:56:18 UTC** at the same URL below. Same Site ID; no replacement registration. Version 2 adds the generic mirror/review surface and owner-scoped draft MCP tools while Mac service access remains disabled and the mirror has no uploaded personal data.

- Source commit: `40d6c02fef91cc65ef777b44cbcafabc4f373b58`
- Saved version ID: `appgprj_6abce385ab0c8191b67a1d0808522bac~appgver_e982535051cc819192c84e224d89bf6f`
- Deployment ID: `appgdep_6abcf8d53ca4819193851f3c22eef19d`
- Artifact: `/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype/site-mirror-deployment.tar.gz`
- Checks: 42 Python tests, 27 D1/API subtests (29 TAP tests), TypeScript, native JXA syntax and prepared plist validation, supported Worker build/source push/archive validation.

This is a tested first-phase implementation awaiting [one-time setup approval](MIRROR_SETUP.md), not live sync or full Things fidelity. No Mac service credential, permission grant, helper installation, real upload, live task write or plugin connection occurred. Hosted browser/API verification is not claimed. The following version 1 record is retained as history.

## Initial version 1

Native Sites terminal status: **succeeded**, September 30, 2026, 11:00:12 UTC.

- Live URL: https://lifeos-cache-test.avinabadas1.chatgpt.site
- Site ID: `appgprj_6abce385ab0c8191b67a1d0808522bac`
- Published version: **1**
- Saved version ID: `appgprj_6abce385ab0c8191b67a1d0808522bac~appgver_f3c0d4865fa081919246592d66d5c6c1`
- Deployment ID: `appgdep_6abceba956c8819189b159086c43b9d2`
- Source commit: `114cc6f7cc69ee17e14b613dc77771d0c3086421`
- Source path: `/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype/site`
- Validated artifact: `/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype/site-deployment.tar.gz`

Final `get_site` confirms that URL, version 1, owner role, custom access restricted to the sole owner, zero allowed groups and zero external visitors. Use the owner's normal ChatGPT sign-in to visit. A native private save/deploy operation enforced the audience; no access policy was broadened.

## Validation and limits

The restored bundled Sites workflow completed successfully: supported Worker build, source commit/push verification, deployment packaging and archive validation. Local Git is clean. The earlier 12 focused synthetic D1/API subtests, TypeScript check and Impeccable detector results remain valid because application source did not change during recovery. Native publication confirms an MCP-capable Site; no plugin was connected or installed.

The sample has two synthetic tasks only and is clearly labeled as a mock. Local tests verify the snapshot/proposal/approval/rejection/pending/applied/conflict paths, isolation, retries, rollback and full D1 runtime restart. This task did not navigate the published URL or claim hosted browser/end-to-end verification. Native deployment success and metadata are the publication evidence. The Site uses supported D1 persistence; production backup/restore policy remains a rollout gate.

The `site/SITE_STATUS.md` file shipped with version 1 records pre-publication checks and recovery history. This document is the subsequent terminal deployment result.

## Access credentials and remaining approval

The expired registration source-repository write credential was renewed once through the native Sites publishing tool after explicit permission to renew this standard short-lived publishing credential. Its value stayed in memory and hidden stdin, never in chat, files or Git remote configuration. No Mac service/bypass credential, persistent account access, real Things data, Calendar access or Things mutation was created.

Next approval is specifically to generate the private Sites Mac service-access credential and implement a narrow adapter route for snapshot upload, fetching approved operations and reporting receipts, bound server-side to the owner. Human proposal approval/rejection must continue requiring owner sign-in. The documented service bearer supplies no user identity, and the current sample intentionally rejects identity-less data calls.

Real supported Things automation and Calendar integration require separate scope review. There is no atomic compare-and-swap across iPhone and Things automation. Mock D1 atomicity is not evidence that live writes can prevent every concurrent overwrite. Live writes remain disabled.
