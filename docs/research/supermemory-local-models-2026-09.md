# Supermemory local models on a MacBook

Checked 23 September 2026 against first-party documentation. This is a configuration recommendation, not a measured battery benchmark on Avi's MacBook.

## The short answer

Use native macOS Ollama, not Ollama inside Docker. Give Supermemory `embeddinggemma` for embeddings and `qwen3.5:4b-mlx` for its extraction/summarization LLM. Make both load only when a request arrives and unload shortly afterward. Start with a small test store because embedding-model changes require re-ingestion, and confirm the installed Supermemory build actually honors its embedding settings.

If absolute minimum background footprint matters more than multilingual recall or GPU-backed embeddings, use Supermemory's built-in `Xenova/bge-base-en-v1.5` instead. It is an English-only local ONNX model with one worker by default and a documented two-minute idle shutdown. It does **not** use MLX. [Supermemory embeddings](https://supermemory.ai/docs/self-hosting/embeddings) and [configuration](https://supermemory.ai/docs/self-hosting/configuration).

## Ollama and MLX are not the same switch

The earlier blanket statement that Ollama is only llama.cpp/Metal is out of date. Ollama announced an MLX engine for Apple Silicon in March 2026; its current catalog labels specific models such as `qwen3.5:4b-mlx` as MLX. It also continues to support GGUF through llama.cpp with Metal acceleration. Thus an ordinary `embeddinggemma` tag should not be described as "an MLX embedding model" merely because Ollama serves it on a Mac. A strict MLX embedding requirement would need a suitable MLX embedding model and compatible OpenAI-style endpoint, then a real integration test; Supermemory itself does not run embeddings through MLX. [Ollama MLX announcement](https://ollama.com/blog/mlx), [Ollama GGUF update](https://ollama.com/blog/improved-performance-and-model-support-with-gguf), [Qwen 3.5 model tags](https://ollama.com/library/qwen3.5/tags), [Supermemory embeddings](https://supermemory.ai/docs/self-hosting/embeddings).

Do not run Ollama in Docker Desktop on macOS for this goal. Ollama says GPU acceleration is unavailable there because Docker Desktop lacks GPU passthrough on macOS. Run the Ollama macOS app/host process; Supermemory can be a separate native process. [Ollama FAQ](https://docs.ollama.com/faq).

## Why these models

| Job | Initial choice | Published facts | Judgment |
| --- | --- | --- | --- |
| Embedding | `embeddinggemma` | Ollama lists a 622 MB, 300M-parameter, 2K-context embedding model. Google's model card gives 768-dimensional output and training across more than 100 languages. | Small enough to load on demand, multilingual if a meeting has non-English passages. Better fit than Supermemory's English-only default for future mixed-language material. Not proven better on our corpus yet. |
| Extraction/summarization | `qwen3.5:4b-mlx` | Ollama labels this tag MLX and lists about 4.0 GB on disk. | A reasonable first quality/latency compromise on a 48 GB M4 Pro. It should not remain loaded all day. Test its ability to extract decisions, owner, time, uncertainty, and source quotes before trusting results. |

Sources: [EmbeddingGemma in Ollama](https://ollama.com/library/embeddinggemma), [Google EmbeddingGemma model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card), [Qwen 3.5 model tags](https://ollama.com/library/qwen3.5/tags).

Supermemory requires a **separate LLM** for contextual chunking, summaries, and memory extraction; an embedding model alone is insufficient. It supports an OpenAI-compatible endpoint for the LLM and a separately configured OpenAI-compatible endpoint for embeddings. Its docs show Ollama at `http://localhost:11434/v1`. [Supermemory configuration](https://supermemory.ai/docs/self-hosting/configuration), [embedding configuration](https://supermemory.ai/docs/self-hosting/embeddings).

## Suggested test configuration, not yet installed

For Supermemory, before creating the first real index:

```text
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=ollama
OPENAI_MODEL=qwen3.5:4b-mlx
OPENAI_FAST_MODEL=qwen3.5:4b-mlx
OPENAI_TEXT_MODEL=qwen3.5:4b-mlx
SUPERMEMORY_EMBEDDING_PROVIDER=openai
SUPERMEMORY_EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
SUPERMEMORY_EMBEDDING_MODEL=embeddinggemma
SUPERMEMORY_EMBEDDING_DIMENSIONS=768
SUPERMEMORY_INGEST_CONCURRENCY=1
```

The non-empty `OPENAI_API_KEY=ollama` is a local compatibility placeholder, not a paid OpenAI key. Keep Ollama bound to loopback and do not expose port 11434 through the existing public tunnel. Supermemory's embedding docs say model/dimension changes are not supported in place; changing them later means a fresh store or full re-ingestion. [Supermemory configuration](https://supermemory.ai/docs/self-hosting/configuration), [embeddings](https://supermemory.ai/docs/self-hosting/embeddings).

For the Ollama host process, start with `OLLAMA_KEEP_ALIVE=1m`, `OLLAMA_MAX_LOADED_MODELS=1`, and `OLLAMA_NUM_PARALLEL=1`. These are conservative tuning choices, **not measured power savings**. Ollama normally keeps a model loaded for five minutes; `OLLAMA_KEEP_ALIVE` can shorten that, and `ollama ps` shows what is currently loaded. Its docs also say a request-level `keep_alive` overrides the environment setting, so verify behavior under Supermemory rather than assuming it. [Ollama FAQ](https://docs.ollama.com/faq).

## Verification before committing to this index

1. Confirm the installed Ollama release supports the chosen `-mlx` tag and that `ollama ps` reports expected loading/unloading. The `embeddinggemma` route may use llama.cpp/Metal rather than MLX; check logs if the backend matters.
2. In a throwaway Supermemory data directory, ingest one English and one non-English text. Check startup logs and run semantic searches in both languages. A prior [Supermemory issue](https://github.com/supermemoryai/supermemory/issues/1336) reported embedding environment variables ignored in older binaries, while current [documentation](https://supermemory.ai/docs/self-hosting/embeddings) says the embedding plan is locked consistently from v0.0.7. The installed binary needs verification.
3. Feed a representative meeting transcript and compare extracted facts with the exact transcript. A small model may miss owner or hedging; no upstream benchmark establishes correctness for LifeOS. LifeOS must keep the raw source and approval gate regardless.
4. Measure energy use during idle and after one ingestion burst on the actual MacBook. A resident HTTP server with unloaded models is likely cheaper than an always-hot model, but the battery claim remains an inference until measured.

MacBook sleep means these background services are paused. "Runs when logged in" is not the same as 24/7 availability; phone access while the laptop is asleep needs a separate always-on host later.
