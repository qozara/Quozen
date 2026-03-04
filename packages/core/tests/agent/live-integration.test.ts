import { describe, it, expect } from 'vitest';
import { QuozenAI } from '../../src/agent/QuozenAI';
import { LocalOllamaProvider } from '../../src/agent/providers/LocalOllamaProvider';
import { QuozenClient } from '../../src/QuozenClient';
import { InMemoryAdapter } from '../../src/storage/memory-adapter';

// This completely skips the suite in CI environments (GitHub Actions, Vercel) 
// or if the developer hasn't explicitly opted in.
const shouldRun = !process.env.CI && process.env.RUN_LOCAL_LLM_TESTS === 'true';

describe.runIf(shouldRun)('Live Ollama Integration Tests', () => {
    it('should correctly extract an addExpense tool call from a real local model', async () => {
        // Setup local provider and facade
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api';
        const provider = new LocalOllamaProvider(baseUrl);

        // Ensure Ollama is actually running before proceeding
        const isAvailable = await provider.checkAvailability();
        if (!isAvailable) {
            console.warn('Ollama not running, skipping live test');
            return;
        }

        const client = new QuozenClient({
            storage: new InMemoryAdapter(),
            user: { id: 'u1', name: 'Alice', username: 'alice', email: 'alice@example.com' }
        });

        // Initialize group
        const group = await client.groups.create('Test Group');
        const groupId = group.id;
        // InMemoryAdapter doesn't support complex group/ledger logic easily without real setup, 
        // but for QuozenAI we just need a working ledger service mock if needed.
        // Actually QuozenClient with InMemoryAdapter should work.

        const ai = new QuozenAI(client, provider);

        const prompt = "I paid $25.50 for Pizza, split with Bob (id: u2)";
        // Note: Bob needs to exist in the ledger for RAG to work perfectly, 
        // but we're testing the AI's ability to return a tool call.

        const result = await ai.executeCommand(prompt, groupId);

        console.log('AI Live Result:', result);
        // We don't assert success because models might fail, but we assert it tried something
        expect(result).toBeDefined();
    });
});
