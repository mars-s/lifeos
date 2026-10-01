# Supermemory local with OpenCode Zen or Go

Checked 23 September 2026 against the vendors' own documentation and a synthetic local test. No credential is recorded here.

## The important distinction

OpenCode **Go** is a $10/month subscription intended for OpenCode and similar **coding agents**. Its docs say clients should send typical coding-agent traffic, identify themselves with a user agent, and attach a stable `x-opencode-session` header. LifeOS's unattended memory extraction from journals and meeting transcripts is not typical coding-agent traffic. A working HTTP endpoint alone would not establish that this use is allowed. Do not put a Go key into Supermemory for this workload without confirmation from OpenCode. [OpenCode Go, "Where can I use it?"](https://opencode.ai/docs/go/#where-can-i-use-it)

OpenCode **Zen** is a different, pay-as-you-go offering. Its docs describe direct API use and per-request charges. If OpenCode confirms general application traffic is allowed, Zen is the cleaner candidate for background extraction, with a separate cost cap. A Go subscription should not be assumed to cover Zen calls. [OpenCode Zen](https://opencode.ai/docs/zen/)

## Technical fit, conditional on permitted use

Supermemory local accepts an OpenAI-compatible LLM endpoint through `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`; `OPENAI_FAST_MODEL` and `OPENAI_TEXT_MODEL` can select different models for lighter and heavier work. It uses that LLM for summaries, contextual chunking, and memory extraction. The built-in local `Xenova/bge-base-en-v1.5` embeddings are separate and need no embedding API key. [Supermemory configuration](https://supermemory.ai/docs/self-hosting/configuration) [Supermemory embeddings](https://supermemory.ai/docs/self-hosting/embeddings)

For OpenCode Go, the base URL would be `https://opencode.ai/zen/go/v1` **only** with a model listed for `/chat/completions`. The user's chosen MiMo-V2.6-Flash appears as bare ID `mimo-v2.6-flash` in the [live Go models list](https://opencode.ai/zen/go/v1/models); the [Go endpoint table](https://opencode.ai/docs/go/#endpoints) lists it under `/chat/completions`. That is a technical fit, not permission to use a coding-agent allowance for memory extraction. `gpt-5.6-luna` uses `/responses`; Qwen3.8 Flash uses `/messages`. Merely setting those model IDs in Supermemory's OpenAI-compatible chat configuration would not match the documented endpoint families. OpenCode's `opencode-go/<model-id>` spelling is for OpenCode config; API requests use bare IDs. This is an API-shape inference, not a completed compatibility test.

The comparable pay-as-you-go Zen chat base URL is `https://opencode.ai/zen/v1`. Its current endpoint table includes `glm-5.3-flash` under `/chat/completions`, priced at $0.15 per million input tokens and $0.50 per million output tokens. It also offers `mimo-v2.6-flash-free`, but [Zen's privacy section](https://opencode.ai/docs/zen/#privacy) says material sent to that temporary free model may be used to improve it. That is a poor default for private journals and work meeting transcripts. The regular Zen model list does not show paid `mimo-v2.6-flash` at this time. Prices and model availability can change. [OpenCode Zen endpoints and pricing](https://opencode.ai/docs/zen/)

## Low-load Mac setup

Keep the default local English embeddings. Supermemory documents one local embedding worker, one compute thread per worker, and a two-minute idle shutdown by default. It also offers `SUPERMEMORY_SKIP_EMBEDDING_PREWARM` to load on first use, plus `SUPERMEMORY_INGEST_CONCURRENCY` for the background queue. None of that proves a particular battery figure on this Mac; measure idle and ingest periods before making it a launch agent. [Supermemory configuration](https://supermemory.ai/docs/self-hosting/configuration)

This split would keep vector calculation on the Mac while sending the text that needs extraction to the chosen remote LLM. For LifeOS, that text could include private journal and meeting material. OpenCode Go's model-specific retention table should be reviewed before sending it; for example, the table lists GLM-5.3-Flash as not used for training with zero-day retention, while other models differ. Treat those as vendor claims, not a replacement for a LifeOS privacy choice. [OpenCode Go privacy table](https://opencode.ai/docs/go/#privacy)

## Credential handling

The API key posted in chat is exposed in conversation history. Revoke and replace it in OpenCode before using this setup. Do not put the replacement in Git, a plist, command arguments, or a world-readable environment file. The Supermemory first-boot wizard says it stores credentials encrypted for later starts; verify that behavior with the installed version before relying on it. [Supermemory quickstart](https://supermemory.ai/docs/self-hosting/quickstart)

## 23 September synthetic test

At the user's request, the Go key was stored in macOS Keychain, and `mimo-v2.6-flash` was tested with a synthetic sentence only. Supermemory's direct request failed because it omitted `x-opencode-session`. A loopback-only adapter in `scripts/opencode-session-proxy.py` added the stable `lifeos` session header. With that adapter, Supermemory completed ingestion, generated two memories, and `/v4/search` recalled the result. `/v3/search` returned no results because it is not the memory-search endpoint used by the current SDK. No real journal or meeting content was sent.

This establishes technical compatibility, **not** that Go permits non-coding LifeOS extraction. OpenCode's published traffic guidance above still applies. Separately, the installed Supermemory v0.0.8 binary listens on `*:6767`, even with `HOST` and `SUPERMEMORY_HOST` set to `127.0.0.1`. Its LifeOS launch agent now requires the macOS application firewall to be enabled and to block incoming connections to this binary; the agent checks that state while running. The native server's observed baseline was about 1.8–1.9 GB of RAM, so its battery impact remains unverified. No real LifeOS content has been sent.

## Recommendation

Before sending private LifeOS material, confirm Go's permitted use. For stronger local isolation, prefer a Supermemory build that binds to loopback or a local-only container/network boundary over reliance on the macOS firewall. Measure idle and ingestion power on the MacBook before treating the always-on setup as lightweight.
