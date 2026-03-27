# 💸 Quozen: Decentralized Expense Sharing

Quozen is a modern, privacy-first expense sharing platform designed for simplicity and collaboration. Unlike traditional apps that store your financial data on proprietary servers, **Quozen is entirely decentralized and serverless**. 

**Your Data, Your Drive:** Quozen uses your personal Google Drive to store groups, expenses, and settlements as standard Google Sheets. You own your data, and you can export, backup, or analyze it using standard spreadsheet tools anytime.

---

## 🏗️ The Ecosystem (Monorepo)

Quozen is built as a highly modular monorepo, decoupling core business logic from the presentation layer to enable extreme portability across browsers, edge networks, and terminal environments.

- 🧠 **`packages/core` (`@quozen/core`)**: The heart of Quozen. An isomorphic TypeScript SDK that handles split-bill algorithms, financial math, optimistic concurrency, and generalized storage adapters (Google Drive & In-Memory).
- 💻 **`apps/webapp`**: The main React Single Page Application (SPA). Built with Vite, Tailwind CSS, Shadcn UI, and React Query for a native-like, responsive experience.
- 🌐 **`apps/api`**: A high-performance, stateless REST API built with Hono and OpenAPI 3.0. Deployable to Cloudflare Workers or Vercel Edge, enabling AI agents and third-party integrations.
- ⌨️ **`apps/cli`**: An interactive terminal application demonstrating Node.js compatibility and offering terminal-based expense management.

## 🚀 Features

### 👥 Collaborative Groups
- **Magic Link Sharing**: Generate a unique link to let anyone join the group instantly with automatic permissions handling.
- **Share via Email**: Invite friends directly via their Google account.
- **Offline Members**: Add members by username (e.g., "Bob") to track expenses for friends who don't use the app.

### 🔄 Smart Data Sync
- **Auto-Sync & Conflict Detection**: Automatically detects changes from other users and prevents accidental overwrites if multiple users edit an expense simultaneously.
- **Pull-to-Refresh**: Intuitive mobile gestures for manual syncing.
- **Edit Safety**: Intelligent background guards prevent data updates while you are actively typing.

### 🌍 Internationalization (i18n) & Localization (l10n)
- **Multi-Language**: Fully translated into **English (US)** and **Spanish (LatAm)**. Auto-detects system preferences.
- **Regional Formatting**: Automatically formats dates and numbers (e.g., `1,234.56` vs `1.234,56`) based on your locale.
- **Currency Selection**: Set your preferred display currency (`USD`, `EUR`, `GBP`, etc.).

## 🔐 Architecture & Security

Quozen utilizes **Client-Side OAuth 2.0** via Google Identity Services. There is **no proprietary backend database**. The relationship is strictly **You ↔ Google**.

1. **Authentication**: When you sign in, Quozen requests an access token directly from Google.
2. **Token Storage**: The access token is stored securely in your environment (localStorage in the browser, or local keychain for the CLI) for the duration of the session.
3. **Direct Operations**: The app and API use this token to fetch and update files directly via the Google Drive and Sheets APIs.

### Required OAuth Scopes
To function, Quozen requests these specific permissions:
- `https://www.googleapis.com/auth/drive.file`: **File Management.** Allows Quozen to access *only* the files it creates. It **cannot** see your other personal photos, docs, or spreadsheets.
- `https://www.googleapis.com/auth/spreadsheets`: **Data Operations.** Allows reading and writing expenses to the specific group sheets.
- `email` & `profile`: **Identity.** Used to display your name/avatar and identify you in expense splits.

---

## 🏃‍♂️ Getting Started

### Prerequisites

1. **Node.js** (v20+) installed.
2. A **Google Cloud Console** project with the following APIs enabled:
   - Google Drive API
   - Google Sheets API
   - Google Picker API (Required for importing shared groups)
3. An **OAuth 2.0 Web Client ID** configured for your development URL (e.g., `http://localhost:3001`).
4. An **API Key** restricted to the Google Picker API.

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the root directory (see `.env.example`):
   ```env
   # OAuth Client ID
   VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
   
   # API Key for Google Picker (File Selection)
   VITE_GOOGLE_PICKER_API_KEY=your_google_api_key_here
   
   # App Port
   VITE_PORT=3001

   # Auto-Sync Polling Interval (Seconds). Set to 0 to disable and use manual button.
   VITE_POLLING_INTERVAL=30
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3001` in your browser.

---

## 🧪 Testing

Quozen maintains high confidence through a multi-layered testing strategy. Tests are categorized into isolated offline tests and live infrastructure tests.

### 1. Non-Interactive Tests (No Login Required)
These tests run completely offline or against local mocked services (like the in-memory storage adapter). **No Google authentication is required.**

- **Unit & Integration Tests**: Fast, isolated tests for core logic, API endpoints, and React components.
  ```bash
  npm run test
  ```
- **E2E Tests**: Full user flow verification using Playwright against a simulated mock storage layer.
  ```bash
  npm run test:web:e2e
  ```
- **Run All Non-Interactive**: Runs all unit tests, mocked E2E tests, and local LLM behavior tests (requires local Ollama running).
  ```bash
  npm run test:all:non-interactive
  ```

### 2. Live Infrastructure Tests (Google Login Required)
These tests verify the actual integration with the real Google Drive API and the Edge AI Proxy (e.g., `infrastructure-smoke.test.ts`).

- **Precondition**: You **must** authenticate locally via the CLI to generate a valid `credentials.json` token before running this suite.
  ```bash
  npm run cli -- login
  ```
- **Run All Tests (Includes Live Smoke Test)**: Runs the non-interactive suite *plus* the live E2E infrastructure smoke test.
  ```bash
  npm run test:all
  ```

### 3. Debugging Tests
By default, mock server requests and browser console logs during E2E tests are suppressed to keep the output clean. If you need to trace HTTP calls or browser errors during a failing test, run the suite with the DEBUG_MOCK flag:

```bash
# Mac/Linux
DEBUG_MOCK=true npm run test:all:non-interactive
```

```powershell
# Windows
$env:DEBUG_MOCK="true"; npm run test:all:non-interactive
```

---

## ⌨️ Command Line Interface (CLI)

Quozen comes with a demo terminal application to manage expenses without a graphical interface. This showcases the usage of the `@quozen/core` package in a Node.js environment.

### Setup
The CLI connects directly to your Google Drive via a local OAuth loopback server. This requires a **Desktop** OAuth client, which is different from the Web client used for the browser frontend.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **APIs & Services > Credentials**.
3. Click **Create Credentials > OAuth client ID**.
4. Select **Desktop app** as the Application type.
5. Copy the generated **Client ID** and **Client Secret**.

### Usage

1. **Authentication**:
   Since the CLI connects directly to your Google Drive, you'll need an OAuth Desktop Client ID and Secret.
   
   * Mac/Linux: *
   ```bash
   export GOOGLE_CLIENT_ID="your-client-id"
   export GOOGLE_CLIENT_SECRET="your-client-secret"
   npm run cli -- login
   ```

   * Windows (PowerShell): *
   ```powershell
   $env:GOOGLE_CLIENT_ID="your-desktop-client-id"
   $env:GOOGLE_CLIENT_SECRET="your-desktop-client-secret"
   npm run cli -- login
   ```

2. **Interactive Dashboard**:
   Launch the main menu to view balances, add expenses, and settle up.
   ```bash
   npm run cli
   ```

---

## 🤖 Agentic UI & Polymorphic Providers

Quozen features a state-of-the-art **Agentic UI** that allows you to manage your expenses using natural language (e.g., *"I paid $50 for lunch, split it with Alice"*). 

The system uses a **Polymorphic Provider Architecture** that automatically routes your commands through a waterfall strategy:

1.  **Bring Your Own Key (BYOK):** If you provide a personal Gemini/OpenAI API key in settings, it is encrypted via our **Edge KMS** and stored safely in your Google Drive. All AI processing then happens using your dedicated quota.
2.  **On-Device AI (Gemini Nano):** If your browser supports it (e.g., Chrome with AI features enabled), Quozen uses your local hardware for 100% private and free processing.
3.  **Local LLM (Ollama):** Power users can connect the WebApp or CLI to a local `Ollama` instance running models like `qwen2.5` or `llama3`.
4.  **Cloud Proxy (Team Key):** As a fallback, Quozen provided a rate-limited cloud proxy utilizing a budget-friendly model for occasional use.

### Enabling Local AI (Chrome)
To use On-Device AI:
1.  Use **Chrome Dev/Canary** (Version 127+).
2.  Enable `#prompt-api-for-gemini-nano` and `#enlightened-optimization-guide` in `chrome://flags`.
3.  Relaunch and verify progress in `chrome://components`.

### Running with Ollama
1.  Install [Ollama](https://ollama.com/).
2.  Start with external origins allowed: `OLLAMA_ORIGINS="*" ollama serve`.
3.  Pull a model: `ollama pull qwen2.5:0.5b`.
4.  Update your `.env` with `VITE_OLLAMA_URL=http://localhost:11434/api` and `VITE_OLLAMA_MODEL=qwen2.5:0.5b`.


Quozen is a research project by the Qozara Lab.