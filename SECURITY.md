# Security Model

Newton is a **local-first development tool**. It runs a small Express backend on your machine that reads/writes your workspace files and proxies requests to AI providers using your own API keys.

## Key Principles

### 1. API Keys
- API keys are stored in your browser's `localStorage` and sent to the local Newton backend with each request.
- The **local backend proxies your key to the AI provider** (OpenAI, Anthropic, Ollama, etc.) in the `Authorization` or `x-api-key` header of outbound `fetch()` calls.
- Keys are **held in memory only** during request processing — they are never persisted to disk, written to logs, or sent anywhere except the AI provider you selected.
- Clearing your browser data removes all stored keys from `localStorage`.

### 2. Workspace Sandboxing
- All file operations are restricted to your workspace directory.
- Path traversal attacks are prevented via `safeResolve()` in `server/safePath.ts`, which uses `path.relative()` to robustly reject any resolved path that escapes the workspace root (including sibling-directory bypasses like `../other-project`).
- Agent `delete` steps additionally reject protected paths (workspace root, `.git/`, etc.).

### 3. CORS Protection
- The backend restricts CORS to `localhost`, `127.0.0.1`, and `::1` origins only. This prevents arbitrary websites you visit from making requests to your local Newton server.

### 4. Rate Limiting
- Sensitive endpoints (`/api/chat`, `/api/edit`, `/api/exec`, `/api/nlsh`, `/api/agent/plan`) are rate-limited to 60 requests/minute.
- All other routes are limited to 300 requests/minute.

### 5. Shell Execution
- The `/api/exec` endpoint allows running shell commands for the NL Terminal feature.
- Commands execute in the workspace directory with a 30-second timeout and 1 MB output cap.
- **This is intentional for a local development tool** (like VS Code's integrated terminal).
- If deploying publicly, disable this endpoint or add authentication.

## Deployment Considerations

### Local / Desktop Use (Recommended)
Newton is designed for local single-user use. Run it on your own machine:
```bash
npm run build && npm start
```

### Self-Hosted for Teams
If hosting for multiple users:
1. Run behind a VPN or private network
2. Add authentication middleware
3. Disable or protect `/api/exec`

### Public Internet
**Not recommended** without modifications:
- Add authentication (OAuth, API keys, etc.)
- Disable or protect `/api/exec`
- Use HTTPS

## Reporting Security Issues

If you discover a security vulnerability, please open an issue or contact the maintainers directly.