# Quozen AI Proxy

Isolated Edge service for AI routing, KMS encryption, and rate limiting.

## Setup

1. Copy `example.dev.vars` to `.dev.vars`.
2. Configure `GOOGLE_GENERATIVE_AI_API_KEY` and `KMS_SECRET`.
3. Run `npm install`.

## Development

```bash
npm run dev
```

---

## Testing the Proxy
The easiest way to test the proxy is to use the Quozen CLI in a separate terminal:

1. Start the proxy: `npm run dev`
2. Run the CLI: `npm run cli`
3. Select **Ask AI** from the menu.

The CLI will utilize the `VITE_AI_PROXY_URL` (default: http://localhost:8788) to communicate with this service.

---

## Testing Offline with Local LLMs (Ollama)

You can route proxy requests to a local Ollama instance for offline development.

### 1. Install Ollama
Download and run Ollama on your machine from [ollama.com](https://ollama.com).

### 2. Pull a tool-capable model
Run:
```bash
ollama run qwen3:0.6b
```

### 3. Update Configuration
Update your `.dev.vars`:
```bash
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_AI_MODEL=qwen3:0.6b
```

---

## API Endpoints

- `POST /api/v1/agent/encrypt`: Encrypts a user API key.
- `POST /api/v1/agent/chat`: Stateless bridge to the LLM (Google or Ollama).
