# Security Model

Newton is designed as a **local-first desktop application**. It runs entirely on your machine and connects directly to AI providers using your own API keys.

## Key Principles

### 1. API Keys Stay Local
- API keys are stored in your browser's `localStorage`
- Keys are sent directly from your browser to the AI provider (OpenAI, Anthropic, etc.)
- Newton's backend never stores, logs, or proxies your API keys
- Clearing browser data removes all stored keys

### 2. Workspace Sandboxing
- All file operations are restricted to your workspace directory
- Path traversal attacks are prevented via `safeJoin()` validation
- The backend cannot access files outside the workspace root

### 3. Shell Execution
- The `/api/exec` endpoint allows running shell commands for the NL Terminal feature
- Commands execute in the workspace directory only
- **This is intentional for a local development tool** (like VS Code's integrated terminal)
- If deploying publicly, disable this endpoint or add authentication

## Deployment Considerations

### Local / Desktop Use (Recommended)
Newton is designed for local single-user use. Run it on your own machine:
```bash
npm run build && npm start
```

### Self-Hosted for Teams
If hosting for multiple users:
1. Run behind a VPN or private network
2. Consider adding authentication middleware
3. Review the `/api/exec` endpoint for your security requirements

### Public Internet
**Not recommended** without modifications:
- Add authentication (OAuth, API keys, etc.)
- Disable or protect `/api/exec`
- Consider rate limiting
- Use HTTPS

## Reporting Security Issues

If you discover a security vulnerability, please open an issue or contact the maintainers directly.
