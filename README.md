# 💸 Quozen: Decentralized Expense Sharing

Quozen is a modern, privacy-first expense sharing platform designed for simplicity and collaboration. Unlike traditional apps that store your financial data on proprietary servers, **Quozen is entirely decentralized, local-first, and serverless**. 

**Local-First & Bring-Your-Own-Backend (BYOB):** Quozen operates on a **Local-First** architecture powered by RxDB. All financial operations execute with **0ms latency** against a local database, providing full offline capability. Data seamlessly synchronizes in the background with your personal Google Drive (stored as transparent Google Sheets) or any custom BYOB sync backend.

---

## 🏗️ The Ecosystem (Monorepo)

Quozen is built as a highly modular monorepo, decoupling core business logic from the presentation layer to enable extreme portability across browsers, edge networks, and terminal environments.

- 🧠 **`packages/core` (`@quozen/core`)**: The heart of Quozen. An isomorphic TypeScript SDK containing split-bill algorithms, an instant **offline-first deterministic natural language parser** with English and Spanish locale packs, RxDB local persistence collections, replication coordination, and pluggable sync backends (Google Drive & In-Memory).
- 🤖 **`packages/ai-services` (`@quozen/ai-services`)**: Hexagonal AI escalation adapter providing optional LLM intent extraction, LRU caching, and error classification. Decoupled from core so Quozen runs 100% offline with zero external AI dependencies.
- 💻 **`apps/webapp`**: The main React Single Page Application (SPA). Built with Vite, Tailwind CSS, Shadcn UI, and reactive query bindings for an instant, responsive local-first experience.
- 🌐 **`apps/api`**: A high-performance, stateless REST API built with Hono and OpenAPI 3.0. Deployable to Cloudflare Workers or Vercel Edge, enabling AI agents and third-party integrations.
- ⌨️ **`apps/cli`**: An interactive terminal application demonstrating Node.js compatibility and offering terminal-based expense management.

## 🚀 Features

### 👥 Collaborative Groups & Flexible Accounts
- **Magic Link Sharing**: Generate a unique link to let anyone join the group instantly with automatic permissions handling.
- **Share via Email**: Invite friends directly via their Google account.
- **Archive & Unarchive Groups**: Archive obsolete or settled groups to declutter your active group list. Archived groups are read-only, organized in a dedicated "Archived" tab, and evaluated with strict laziness (zero remote Google Drive/Sheets calls). Restore them anytime with a single click.
- **Drive Deletion Detection & Self-Healing**: Detects if a spreadsheet file was trashed or deleted in Google Drive, informs the user with an alert, and auto-prunes the entry from active and archived lists.
- **Personal, Shared & Offline Accounts**: Decouples logged-in Google **Users** from group ledger **Accounts**:
  - **Personal Account**: Default 1:1 account for an individual user.
  - **Shared Account**: Multiple logged-in users (e.g., a family, a couple, or a subgroup of friends) can link to and co-manage a single consolidated account that counts as one share in group splits.
  - **Offline Account**: Add accounts without an email (e.g., `"Bob"`) and let any logged-in user switch to or record expenses on their behalf.

### ⚡ Instant Deterministic Parser & Human-in-the-Loop Confirmation
- **Instant Natural Language (< 1ms)**: Dictate or type commands like *"Add 45 for dinner with Bob"* or *"Pagué 30 almuerzo"* and have them parsed instantly on device. Works **100% offline**, requires **zero AI calls**, and incurs **zero token costs**.
- **Human-in-the-Loop Draft Confirmation (Never Auto-Commit)**: Neither the parser nor AI writes directly to your ledger. Quozen always opens an interactive **Draft Review** dialog (`AddExpenseDrawer` or `SettlementModal`) pre-populated with amounts, members, categories, and split ratios, allowing you to inspect, adjust, and explicitly confirm before committing.
- **English & Spanish Locale Packs**: Built-in grammatical pattern matching handles colloquial splits (`with Bob, Charlie`), exclusions (`sin Ana`, `except Bob`), itemized debts (`Bob 30 y Charlie 20`), and settlements (`I paid Bob 25 cash`, `settle up with Alice`).
- **Pragmatic AI — Only Where Genuinely Needed**: We reserve generative LLMs and computer vision strictly for high-value tasks that genuinely require machine perception—such as scanning paper receipts/bills, itemized receipt breakdown, complex unstructured notes, or resolving ambiguous phrasing on user demand via **"Refine with AI"**.
- **Privacy by Default (Zero Localhost Probing)**: Quozen never probes local network ports (like Ollama on `localhost:11434`) unless you explicitly toggle Local Network Access in Profile Settings, eliminating browser Private Network Access security warnings.

### 🔄 Smart Data Sync & Resilience
- **0ms Latency & Full Offline Reliability**: Read, write, and balance expenses instantly without waiting for network roundtrips.
- **Reactive Background Sync & LWW Resolution**: RxDB replication runs in the background with Last-Write-Wins (LWW) conflict resolution across devices.
- **Declarative Schema Self-Healing**: Automatically repairs remote Google Sheet columns and structures during synchronization without blocking local usage.
- **Pull-to-Refresh**: Intuitive mobile gestures for manual syncing.

### 🌍 Internationalization (i18n) & Localization (l10n)
- **Multi-Language**: Fully translated into **English (US)** and **Spanish (LatAm)**. Auto-detects system preferences.
- **Regional Formatting**: Automatically formats dates and numbers (e.g., `1,234.56` vs `1.234,56`) based on your locale.
- **Currency Selection**: Set your preferred display currency (`USD`, `EUR`, `GBP`, etc.).

### 📱 Mobile-First UX & Asynchronous Feedback Conventions
Quozen enforces strict interaction conventions for local vs. remote operations (see [ADR 20261014](docs/adr/20261014-sync-async-ux-feedback-guidelines.md)):
- **Zero Success Toasts for Local Actions**: Local RxDB writes (0ms latency) provide feedback via 60fps reactive updates, animated drawer dismissal, and subtle haptic feedback. No intrusive success toasts obstruct the screen.
- **Mandatory UI Blocking for Cloud Operations (>300ms)**: Any action communicating with external cloud APIs (Google Drive/Sheets) displays inline spinners, locks drawers (`dismissible={!isPending}`), and blocks interaction until the server responds.
- **Passive Background Diagnostics**: Background replication blips do not spam error toasts. Health states route to the header `SyncTrigger` glyph (spinning, amber warning, or offline) with an on-demand inspector popover.
- **In-Place Micro-Interactions**: Ephemeral actions like copying magic links or manual refresh trigger in-place icon transitions (e.g., checkmark `<Check />` or `<RefreshCw className="animate-spin" />`) rather than floating toasts.

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

## 🤖 Pragmatic AI & Escalation Architecture

Quozen embraces **Pragmatic AI**: we do not burn energy, API tokens, or user patience sending simple everyday commands to cloud LLMs when a deterministic, sub-millisecond local algorithm does the job better, faster, and 100% offline.

### When is AI Used?
1. **Scanning Bills & Receipts (OCR / Multimodal)**: Extracting line items, totals, dates, and taxes from photos of receipts or invoices.
2. **On-Demand Escalation ("Refine with AI")**: When voice dictation or a command contains ambiguous or complex phrasing, users can click **"Refine with AI"** from the draft confirmation banner to request deeper LLM interpretation.
3. **Complex Unstructured Notes**: Extracting multi-way shared costs from long-form chat messages or unstructured trip itineraries.

### Polymorphic Provider Waterfall (On Escalation)
When AI escalation is triggered, Quozen resolves the request through a configurable, privacy-first waterfall:

1. **Bring Your Own Key (BYOK):** Users can supply a personal Google Gemini API key. The key is encrypted via edge KMS (AES-256-GCM) and stored exclusively in the user's personal Google Drive with **zero server persistence**. All requests use the user's own quota with zero rate limits.
2. **On-Device AI (Gemini Nano):** If your browser supports Chrome's Prompt API, Quozen runs inference locally on device for 100% private, zero-latency execution.
3. **Qozara Intelligence:** Out-of-the-box edge AI powered by Gemini 2.0 Flash at `https://ai.qozara.org`, protected by sliding window rate limits (20 req/day for authenticated Google accounts; 5 req/day for anonymous users).
4. **Local LLM (Ollama):** Optional local Ollama integration for users running self-hosted models (`qwen2.5`, `llama3.2`). Local network access is **disabled by default** to protect user privacy and avoid browser permission popups; users can enable it anytime in **Profile > Preferences > Allow Local Network Access**.

### Enabling Local AI (Chrome)
To use On-Device AI:
1. Use **Chrome Dev/Canary** (Version 127+).
2. Enable `#prompt-api-for-gemini-nano` and `#enlightened-optimization-guide` in `chrome://flags`.
3. Relaunch and verify model status in `chrome://components`.

### Running with Ollama
1. Install [Ollama](https://ollama.com/).
2. Enable **Allow Local Network Access (Ollama)** in Quozen under **Profile > AI Assistant**.
3. Start with external origins allowed: `OLLAMA_ORIGINS="*" ollama serve`.
4. Pull a model: `ollama pull qwen2.5:0.5b`.
5. Update your `.env` with `VITE_OLLAMA_URL=http://localhost:11434/api` and `VITE_OLLAMA_MODEL=qwen2.5:0.5b`.

Quozen is a research project by the Qozara Lab.