# 🔍 Newton — Semantic Code Search

Newton's killer feature is a built-in **semantic code search engine** that lets the AI understand your entire codebase — no API key required, no external embeddings service.

This is what makes Newton genuinely competitive with Cursor: the AI doesn't just see the file you have open; it can find relevant code anywhere in your project.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    Your Codebase                      │
│         src/  server/  shared/  components/          │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                 1. File Walker                        │
│   Ignores node_modules/.git/dist/build               │
│   Skips binary files (png, woff, lock…)              │
│   Skips files > 100KB                                │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              2. Symbol-Aware Chunker                  │
│   Splits files at function/class/interface bounds    │
│   Uses language-agnostic regex patterns              │
│   Labels chunks with symbol names                    │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              3. TF-IDF Vectorizer                     │
│   Tokenizes: splits camelCase, snake_case, kebab     │
│   Removes 90+ stopwords                              │
│   Adds bigrams for phrase matching                   │
│   Computes term frequency (sublinear scaling)        │
│   Applies inverse document frequency weighting        │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              4. Cosine Similarity Search              │
│   Query is vectorized the same way                   │
│   Ranked by cosine similarity in TF-IDF space        │
│   Symbol-name matches get a 2x boost                 │
│   Returns top-N chunks with scores                   │
└─────────────────────────────────────────────────────┘
```

---

## 1. Symbol-Aware Chunking

Files aren't indexed as one blob. Instead, they're split into **logical units** at code structure boundaries:

| Language | Split Points | Detected Symbols |
|---|---|---|
| **JS/TS** | `export function`, `class`, `interface`, `type`, `enum`, `const Name` | Function & class names |
| **Python** | `def`, `class` | Method & class names |
| **Go** | `func`, `type struct` | Function & type names |
| **Rust** | `fn`, `struct`, `enum`, `trait` | Function & type names |
| **Java/C#** | `public/private class`, methods | Class & method names |
| **Ruby** | `def`, `class`, `module` | Method & class names |

**Benefits:**
- Search results point to the **exact function or class**, not a 500-line file
- Each result includes a `startLine`, `endLine`, and `symbol` name
- If no structural boundaries are found, falls back to fixed 50-line blocks

---

## 2. TF-IDF Vector Space Model

Newton uses **TF-IDF** (Term Frequency–Inverse Document Frequency) — the same technique that powered early code search engines before embeddings became cheap.

### Tokenizer

```
Input:  "calculateUserTotal"
Output: ["calculate", "user", "total", "calculate_user", "user_total"]
```

- Splits **camelCase**, **snake_case**, **kebab-case**, and **dot/slash** separators
- Removes 90+ common English stopwords + code keywords (`return`, `const`, `function`…)
- Adds **bigrams** (`word1_word2`) for phrase matching
- Filters out tokens shorter than 2 chars or longer than 40 chars

### Scoring

```
tf(t, d) = 1 + log(count(t, d))       # sublinear term frequency
idf(t)   = log(N / df(t))             # rare terms score higher
weight   = tf(t, d) × idf(t)          # TF-IDF weight
score(q, d) = cos(θ)                   # cosine similarity
```

### Symbol Boost

If the query contains a chunk's symbol name (e.g. searching "useStore" matches a chunk labeled with symbol `useStore`), that chunk's score is **doubled** (`2.0×`).

---

## 3. Incremental Indexing

The index is **incremental** — it doesn't re-scan unchanged files.

1. On startup, loads the cached index from `.newton-index.json`
2. Checks each file's `mtime` (modification time)
3. Only re-chunks and re-vectorizes files that changed
4. Rebuilds IDF weights across all chunks
5. Persists the updated index back to disk

This means **saves are fast** — only the changed file is re-indexed, and the `/api/file` POST endpoint fires the reindex in the background (non-blocking).

---

## 4. Auto-Context Injection

Every chat message is automatically enriched with codebase context:

1. User sends a message: *"Where is the auth logic?"*
2. Server extracts the last user message
3. Runs `index.getContextForQuery(message, 6000)` — gets top 10 relevant chunks (up to 6KB)
4. Injects this into the system prompt under `RELEVANT CODEBASE CONTEXT`
5. The AI can now reference real file paths and line numbers

**This is why Newton's AI feels like it knows your codebase** — because it does.

---

## 5. @-Mentions (Explicit Context)

In addition to automatic context, users can **explicitly attach** files:

1. Type `@` in the chat box → a search popup appears
2. Results are powered by the same TF-IDF index (`GET /api/search?q=...`)
3. Select a file → it's added as a "context chip"
4. On send, attached files are injected into the prompt with clear delimiters

Both mechanisms work together:
- **Automatic:** semantic search finds relevant code the user might not know about
- **Explicit (@-mentions):** user pins specific files they want the AI to focus on

---

## API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/search?q=...&limit=N` | `GET` | Search the codebase |
| `/api/index/stats` | `GET` | Indexer stats (files, chunks, indexing status) |
| `/api/index/rebuild` | `POST` | Force a full reindex |

See [`docs/API.md`](./API.md) for request/response schemas.

---

## Configuration

The indexer runs automatically with sensible defaults. No configuration needed.

- **Ignored directories:** `node_modules`, `.git`, `dist`, `build`, `.next`, `.cache`, `coverage`, `__pycache__`, `vendor`, `target`, `tmp`, `.turbo`, `.vercel`
- **Ignored file types:** Binary files (images, fonts, archives, media), `.lock` files
- **Max file size:** 100KB (skips generated/minified files)
- **Cache file:** `.newton-index.json` (created in workspace root, gitignored)

---

## Performance

- **Indexing speed:** ~1000 files/sec for typical source code
- **Search latency:** <10ms for codebases up to ~10,000 chunks
- **Memory:** ~1-2KB per chunk (TF-IDF vectors are sparse)
- **Startup:** Instant — loads cached index, then reindexes changes in background

The TF-IDF approach is **O(query_terms × chunks)** per search, but since we only iterate over query terms (not the full vocabulary), it's extremely fast in practice.

---

## Why Not Embeddings?

TF-IDF was chosen for Newton's core for several reasons:

1. **Zero dependencies** — no API key, no model download, no GPU
2. **Instant** — no network round-trip for embeddings
3. **Good enough** — for code search, exact keyword/phrase matching is often *better* than fuzzy semantic embeddings (developers search for `useAuth`, not "the login function")
4. **Symbol-aware** — chunking by code structure gives precision that raw embeddings lack

The index has a `setEmbeddingsMode()` hook for future enhancement when an OpenAI key is available, but the TF-IDF core works perfectly standalone.