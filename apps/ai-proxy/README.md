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

## Testing the Proxy Locally (Google Cloud)

To test the proxy without running the full web app, you can use the interactive CLI test script.

1. Ensure `.dev.vars` has a valid `GOOGLE_GENERATIVE_AI_API_KEY`.
2. Set `AI_PROVIDER=google` (default).
3. Run:
   ```bash
   npm run test:interactive
   ```
   (Or `npm run test:ai:interactive` from the root)

---

## Testing Offline with Local LLMs (Ollama)

You can route proxy requests to a local Ollama instance for offline development.

### 1. Install Ollama
Download and run Ollama on your machine from [ollama.com](https://ollama.com).

### 2. Pull a tool-capable model
Run:
```bash
ollama run llama3.2
```

### 3. Update Configuration
Update your `.dev.vars`:
```bash
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/api
GOOGLE_GENERATIVE_AI_MODEL=llama3.2
```

### 4. Run the interactive test
```bash
npm run test:interactive
```

---

## API Endpoints

- `POST /api/v1/agent/encrypt`: Encrypts a user API key.
- `POST /api/v1/agent/chat`: Stateless bridge to the LLM (Google or Ollama).
