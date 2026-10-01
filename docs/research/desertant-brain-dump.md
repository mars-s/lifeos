# Desert Ant Labs for the LifeOS brain dump

Research date: 2026-09-22

Sources are limited to Desert Ant Labs' website, its GitHub repositories, its Hugging Face organization, and its license. Product and benchmark numbers below are vendor claims, not independent validation.

## Recommendation

Use Desert Ant as an optional **local preprocessing layer**, not as LifeOS's memory.

The promising end state is Desert Ant's **Schemer** model: it accepts a caller-supplied JSON schema and extracts typed fields from free text locally. That is an unusually close match for turning a brain dump into candidate tasks, projects, dates, durations, and people. Its model artifacts are publicly downloadable, including Apple Core ML encoders. However, Schemer is still a private pre-release: Desert Ant's core SDK does not ship a Schemer runtime and the CLI does not expose it. A custom integration would need to assemble the tokenizer, encoder, decoder heads, and harness behavior itself. That is suitable for an experiment, but not a dependency for the first working LifeOS flow. [Schemer artifacts](https://huggingface.co/desert-ant-labs/schemer/tree/main) [Core SDK status](https://github.com/Desert-Ant-Labs/desert-ant-core#in-closed-beta) [Schemer model card](https://huggingface.co/desert-ant-labs/schemer)

Build the brain-dump pipeline now around a LifeOS-owned capture record in local SQLite. Let ChatGPT interpret that record into a typed proposal, but never let the conversation be the only copy. Later, Schemer can replace or verify the interpretation stage without changing the storage or approval model.

## What Desert Ant is

Desert Ant Labs ships small, specialized models for text, audio, image, and video tasks. The supported SDKs run inference on the user's device through Core ML, LiteRT, WebAssembly, or a native Node runtime. It is a model-and-runtime catalog, not a database, notes app, vector store, agent runtime, or durable memory service. [Desert Ant homepage](https://desertant.com/) [Desert Ant Core](https://github.com/Desert-Ant-Labs/desert-ant-core)

The models relevant to LifeOS are:

| Model | Useful LifeOS role | Important limitation |
| --- | --- | --- |
| Schemer | Extract task-like records against a LifeOS JSON schema | Public model artifacts, but no supported SDK or CLI command today |
| Gist | Add coarse topic labels locally | Fixed 36-topic taxonomy; it cannot reliably choose custom Things areas such as Chemwatch or University |
| Title | Produce a short factual title and description | Available through the CLI only on Apple silicon; it summarizes rather than decomposes a dump into tasks |
| Redact | Remove or reversibly mask PII before text is sent to a cloud model | Redaction can remove context needed for task assignment; use it as a user-selectable privacy mode |
| Voz | Transcribe a locally recorded brain dump | Useful only when LifeOS receives audio; ChatGPT voice already hands the model text |

Gist is available for Swift, Kotlin, JavaScript, browser, and Node. It returns probabilities over Desert Ant's own 36-topic taxonomy and is optimized for short titles and descriptions. That makes it useful as a secondary tag signal, not as the authority for LifeOS areas or projects. [Gist documentation](https://desertant.com/docs/gist/)

## Can it run locally, through MCP, or as a skill?

Yes locally. The SDK supports macOS, browser, and Node paths, and model weights download once into a managed platform cache or an application-selected directory. Models can also be bundled or self-hosted for offline and air-gapped use. SDK releases pin model revisions and verify downloads before use. [Model downloads and caching](https://github.com/Desert-Ant-Labs/desert-ant-core#model-downloads-and-caching)

The `desertant` CLI is the easiest supported agent integration today. Commands accept stdin, can emit JSON, and publish machine-readable command schemas. Running `desertant setup` installs guidance for Claude Code, Pi, and Codex. This is a shell skill/configuration integration, not an MCP server. The CLI README explicitly says chat applications without shell access cannot use it yet and that an MCP server is planned. [Desert Ant CLI](https://github.com/Desert-Ant-Labs/desert-ant-cli) [Coding-agent setup](https://github.com/Desert-Ant-Labs/desert-ant-cli#coding-agents)

For ChatGPT web, the practical route is therefore:

1. ChatGPT calls the existing LifeOS MCP server.
2. LifeOS invokes a narrowly allow-listed local SDK or CLI operation internally.
3. LifeOS returns typed results to ChatGPT.

Do not expose a generic shell or generic `desertant` command through the plugin. Publish specific tools such as `classify_capture_topics` or `redact_capture_preview` with bounded input and output schemas. A Schemer-backed tool should remain experimental until its public artifacts can be reproduced against the vendor harness or Desert Ant ships a supported runtime.

## Verified Core ML artifact

The public `schemer-encoder-256-int4.mlpackage.zip` was downloaded to the LifeOS model cache and its SHA-256 digest matched Desert Ant's manifest:

```text
977bc7dce3bc2545997305be969cf192e9038c31148e85785cdb3d54433e485e
```

Apple's `coremlcompiler metadata` directly reports:

- minimum deployment target: macOS 15.0 or iOS 18.0;
- inputs: `input_ids` and `attention_mask`, both Int32 with shape `[1, 256]`;
- output: `hidden_states`, Float16 with shape `[1, 256, 768]`;
- model type: ML Program with mixed Float16 and Int4 storage.

This confirms the artifact is an optimized encoder, not a standalone text-to-JSON model. Desert Ant's manifest separately lists the tokenizer, ONNX decoder heads, and test harness data needed to reproduce complete schema extraction. The model card's 8.1 ms figure is therefore an end-to-end design signal, but specifically a vendor benchmark for a 256-token encoder forward pass, not a locally verified complete brain-dump extraction time. [Core ML files](https://huggingface.co/desert-ant-labs/schemer/tree/main/coreml) [Artifact manifest](https://huggingface.co/desert-ant-labs/schemer/raw/main/manifest.json)

## Storage and privacy model

Desert Ant is stateless inference from LifeOS's point of view. Its durable local state is primarily downloaded model files. The SDK lets the host app choose their directory, and the CLI writes explicitly requested output files such as transcripts or cleaned media. Desert Ant does not provide a task store, capture history, semantic index, or synchronization layer. LifeOS must own those. [Core cache documentation](https://github.com/Desert-Ant-Labs/desert-ant-core#model-downloads-and-caching) [CLI files and behavior](https://github.com/Desert-Ant-Labs/desert-ant-cli)

The models run locally and Desert Ant says telemetry never contains inputs, outputs, or user content. There is still a small outbound usage signal: the SDK generates a device-scoped identifier to count monthly active devices. It is not tied to an account and is not linked across apps, platforms, or installations. This is more private than sending brain dumps to an inference API, but it is not literally zero network behavior unless the model is deployed in a supported offline arrangement. [License section 7](https://license.desertant.com/1.0)

Other implications:

- The SDK/model license is source-available, not open source. The CLI itself is MIT-licensed.
- The free tier is below 100,000 monthly active devices per platform and per model; commercial licensing applies above that.
- A visible “Powered by Desert Ant Labs” attribution is required where the medium permits.
- The license forbids using models, outputs, or logs to train a competing model, redistributing the models as a standalone service, reverse engineering weights, and disabling usage telemetry.
- The host application owns its model outputs and logs. LifeOS remains responsible for protecting any brain-dump text it stores.

These terms are acceptable for a personal V1, but they are material if LifeOS is later open-sourced or distributed. [Desert Ant license](https://license.desertant.com/1.0)

## Recommended LifeOS brain-dump flow

ChatGPT should be the conversational interpreter, not the system of record:

```text
voice or typed dump
        |
        v
capture_brain_dump(raw text)
        |
        v
LifeOS SQLite capture + immutable raw-text hash
        |
        +--> optional local Redact / Gist / Title signals
        |
        v
ChatGPT returns typed candidate tasks/projects/dates
        |
        v
LifeOS stores a semanticization revision with provenance
        |
        v
review card -> proposal -> approval -> Things / Calendar
```

The minimum durable entities should be:

- `capture`: ID, original text, created time, source, locale/time zone, content hash, and processing state.
- `semanticization_revision`: immutable version, extractor identity/version, schema version, candidate items, confidence or unresolved fields, and source spans when available.
- `candidate_item`: task/project/note/event kind, title, notes, suggested area/project, date constraints, duration, dependencies, and the exact capture span that supports it.
- `materialization_link`: the approved Things ID and Calendar event ID created from a candidate.

The ChatGPT tool sequence can work without any paid model API inside LifeOS:

1. `capture_brain_dump` immediately saves the user's exact transcript and returns a `capture_id`.
2. ChatGPT interprets the returned capture under a strict LifeOS schema.
3. `submit_semanticization(capture_id, source_hash, items, unresolved)` validates and durably stores ChatGPT's interpretation.
4. `render_brain_dump_review` shows editable candidates grouped by area/project.
5. Only reviewed candidates become an ordinary immutable LifeOS proposal.

This design survives a deleted chat, a model retry, or switching from ChatGPT to a local extractor. It also makes reprocessing safe: a new model creates a new semanticization revision instead of overwriting the original dump.

## Concrete integration options

| Option | Can start now? | Quality and cost | Recommendation |
| --- | --- | --- | --- |
| ChatGPT interprets; LifeOS stores raw capture and typed revision | Yes | Best reasoning today; no separate API bill because inference stays in the user's ChatGPT session | Build first |
| LifeOS runs available Desert Ant CLI models before ChatGPT | Yes | Local and fast; adds privacy/topic/title signals but does not decompose tasks | Add selectively after the capture store |
| Schemer performs the typed extraction locally | Experimental only | Excellent architectural fit; public Core ML encoder and decoder artifacts, but no supported complete runtime | Keep an adapter boundary; reproduce the harness before trusting it |
| Use ChatGPT conversation history as the capture store | Technically | Fragile provenance, hard to query/reprocess, tied to one client | Do not use |
| Write inferred tasks straight to Things | Technically | Loses raw provenance and repeats the current safety problem | Keep the review/proposal boundary |

## Acceptance test for the first slice

Speak or paste a dump containing at least four items across University, Personal, and one work area, including one vague item and two dated items. After the ChatGPT conversation is closed, LifeOS should still be able to:

1. retrieve the exact original capture;
2. show every candidate with its supporting text span;
3. mark unresolved ambiguity instead of inventing details;
4. let the user edit grouping, dates, and duration;
5. create a multi-day proposal without mutating Things or Calendar;
6. apply only after approval and retain links from the resulting records back to the capture.

That proves ChatGPT is acting as an interchangeable reasoning layer while LifeOS remains the durable, auditable source of truth.
