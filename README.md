# Multi-document RAG assistant with citations

Ask questions about your PDFs: the assistant streams its answer while citing the exact document and page, with clickable citations that open the source passage.

## Features

- **Background multi-document ingestion** — upload several PDFs (click or drag-and-drop), get an immediate response, then asynchronous indexing with a progress bar; page-by-page extraction, chunking with overlap.
- **Hybrid search** — multilingual embeddings computed locally (`multilingual-e5-small` via transformers.js, free and offline) **fused with a BM25 index** through Reciprocal Rank Fusion.
- **Contextualized chunks** — every passage carries its ancestry (`document › page title › section`), so it stays findable even when cut mid-section.
- **Cited answers** — the LLM (Claude Sonnet 5) relies exclusively on the retrieved passages and cites its sources as `[n]`.
- **Token-by-token streaming** — the answer appears as it is generated (SSE), with a Stop button.
- **Multi-turn history** — the conversation keeps the context of previous exchanges.
- **Clickable citations** — each `[n]` opens a panel showing the exact passage, its page and relevance score, with a link to the PDF opened at the right page.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Angular 21 (signals, standalone) + Tailwind CSS 4 |
| Backend | Node.js + Fastify 5 (TypeScript, tsx) |
| LLM | Claude Sonnet 5 (`@anthropic-ai/sdk`, streaming + prompt caching) |
| Embeddings | `Xenova/multilingual-e5-small`, run locally via `@huggingface/transformers` |
| Vector store | Local store (file + in-memory cosine) by default, **Qdrant** optionally via `QDRANT_URL` |

### Why hybrid search

On a homogeneous corpus (three project sheets with similar vocabulary), `multilingual-e5-small` scores
every passage between 0.81 and 0.88 similarity: the ranking turns into noise, and a question naming a
specific section ("the **Must** features") does not bring that section up. BM25 finds exactly those
rare terms. Both rankings are fused with RRF, which only compares ranks — so no calibration is needed
between two incomparable score scales.

## Production & security

Built to be exposed publicly as a demo without leaving the API bill or the corpus at the mercy of visitors.

**Robust ingestion**
- The PDF and its metadata are saved *before* indexing, which then runs in a background queue (one job at a time: embedding is CPU-bound). The `processing → ready | failed` status is exposed to the UI.
- Crash recovery: on restart, documents left in `processing` are re-indexed from the saved PDF. Indexing is idempotent (chunks already written are deleted before rewriting), so there are no duplicates.
- Atomic JSON writes (temp file then `rename`): a hard stop corrupts neither the registry nor the vector store.
- Validation: the `%PDF-` signature is checked (the extension is not enough), duplicates are refused by SHA-256 fingerprint, size (25 MB) and page limits, clear messages for encrypted, corrupt or scanned PDFs.
- Embeddings computed in batches of 32: bounded memory on large documents and real progress reporting.

**Security & operations**
- **Demo mode** (`DEMO_MODE=true`): preloaded read-only corpus, upload and delete refused (403) and hidden in the UI.
- **Per-IP rate limiting**: 10 questions/min, 5 uploads/min, 100 requests/min overall (`TRUST_PROXY=true` behind a host to read the real client IP).
- **Input validation** with Fastify JSON schemas: question ≤ 2,000 characters, conversation ≤ 40 messages, UUID identifiers (no path traversal). Only the last 10 turns are sent to the LLM.
- **Prompt-injection defense**: each passage is wrapped in a `<source>` tag (tags and attributes neutralized) and the system prompt requires treating its content as data, never as instructions.
- Security headers (`@fastify/helmet`, strict CSP with no inline script), CORS restricted to an origin allow-list, 5xx errors without internal details.
- Structured per-question logs (passage count, retrieval time, tokens used) without the text of questions or documents.
- Graceful shutdown on `SIGTERM`, `/api/health` endpoint (embedding model ready, demo mode).

## Security tests

```bash
cd server && npm test        # API + prompt construction (no API key, no model download)
cd server && npm run test:llm # live attacks against Claude (needs ANTHROPIC_API_KEY, a few cents)
cd web && npx ng test --watch=false
```

| Suite | What it attacks |
|---|---|
| `server/test/prompt-construction.test.ts` | Indirect prompt injection: document text closing its `<source>` tag and forging another (any case), quotes/brackets in document names and section headings, history truncation |
| `server/test/api-security.test.ts` | Path traversal on document ids (encoded, double-encoded, backslash), disguised and oversized uploads, duplicates, demo-mode bypass, forged `system` turns, smuggled content blocks, assistant prefill, oversized history, malformed JSON, prototype pollution, rate limits (including `X-Forwarded-For` spoofing), CORS, CSP and security headers, 5xx detail leaks, header injection through file names |
| `server/test/llm/prompt-injection.test.ts` | Real model, production prompt: instruction override hidden in a document, system-prompt exfiltration, markdown-image data exfiltration, forged citations and facts, user request to answer outside the sources, persona hijack |
| `web/src/app/components/chat/chat.spec.ts` | XSS: HTML/script in answers, bold runs, questions, source names, sections and snippets renders as text; forged citation markers stay plain text |

CI runs everything except the live LLM suite on every push.

## Getting started

### 1. Backend

```bash
cd server
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY
npm run dev            # http://localhost:3000
```

On first launch, the embedding model (~100 MB) is downloaded and then cached.

### 2. Frontend

```bash
cd web
npm install
npm start              # http://localhost:4200 (proxy /api → :3000)
```

### 3. Qdrant (optional)

By default vectors are stored in `server/data/vectors.json` — enough for a demo.
To use Qdrant:

```bash
docker compose up -d
```

then uncomment `QDRANT_URL=http://localhost:6333` in `server/.env`.

### 4. Production mode locally

The server then also serves the Angular app, on a single origin:

```bash
cd web && npm run build
cd ../server && NODE_ENV=production npm start   # http://localhost:3000
```

## Deployment

The root `Dockerfile` produces a single image (Angular build + Node 24 API, embedding model
preloaded). It is built by the host (Render, Railway, Fly.io…); Docker is not required locally.

1. Create a service from the repository (the `Dockerfile` is detected automatically).
2. Mount a persistent volume on `/data` (registry, PDFs, vectors).
3. Variables: `ANTHROPIC_API_KEY`, and `DEMO_MODE=true` for a public demo.
4. To preload the corpus: deploy first without `DEMO_MODE`, add the PDFs through the UI, then enable `DEMO_MODE`.

GitHub Actions CI type-checks the server and builds the frontend on every push.

## Architecture

```
server/src/
  server.ts              # Fastify bootstrap (security, rate limiting, routes, static web app)
  routes/documents.ts    # upload (validation, 202), list, delete, source PDF
  routes/chat.ts         # POST /api/chat — SSE stream (sources, delta, done, error)
  services/ingest.ts     # background indexing queue, resume after restart
  services/pdf.ts        # per-page text extraction (unpdf), rejoining hyphenated words
  services/chunking.ts   # ~1000-character chunks + section detection
  services/embeddings.ts # transformers.js pipeline (E5 query/passage prefixes)
  services/lexical.ts    # BM25 index (exact keywords)
  services/vector-store.ts # VectorStore abstraction: local or Qdrant
  services/rag.ts        # dense+BM25 RRF fusion, cited prompt, Claude streaming
web/src/app/
  components/sidebar/    # upload + document management
  components/chat/       # conversation, streaming, citations, source panel
  chat.service.ts        # SSE client (fetch + ReadableStream)
  api.service.ts         # document CRUD, indexing status polling
```

## API

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/documents` | Upload a PDF (multipart) → `202`, indexed in the background; `409` duplicate, `413` too large, `415` not a PDF |
| `GET` | `/api/documents` | Documents with their status (`processing` + progress, `ready`, `failed` + reason) |
| `DELETE` | `/api/documents/:id` | Deletes the document and its vectors |
| `GET` | `/api/documents/:id/file` | Original PDF (`#page=N` for citations) |
| `POST` | `/api/chat` | `{ messages: [...] }` → SSE stream of the cited answer |
| `GET` | `/api/health` | Server state (embedding model ready, demo mode) |
