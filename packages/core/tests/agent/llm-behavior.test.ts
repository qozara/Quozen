import { describe, it, expect, beforeAll } from 'vitest';
import { QuozenAI } from '../../src/agent/QuozenAI';
import { LocalOllamaProvider } from '../../src/agent/providers/LocalOllamaProvider';
import { QuozenClient } from '../../src/QuozenClient';
import { InMemoryAdapter } from '../../src/storage/memory-adapter';
import * as dotenv from 'dotenv';
import * as path from 'path';

// This completely skips the suite in CI environments (GitHub Actions, Vercel)
// or if the developer hasn't explicitly opted in.
const shouldRun = !process.env.CI && process.env.RUN_LOCAL_LLM_TESTS === 'true';

describe.runIf(shouldRun)('AI Goal: Intelligence Validation (Ollama + InMemory)', () => {
    let client: QuozenClient;
    let ai: QuozenAI;
    let groupId: string;
    let isAvailable = false;

    beforeAll(async () => {
        const envPath = process.cwd().endsWith('core') ? path.resolve(process.cwd(), '../../apps/ai-proxy/.dev.vars') : path.resolve(process.cwd(), 'apps/ai-proxy/.dev.vars');
        dotenv.config({ path: envPath });

        const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api').replace('localhost', '127.0.0.1');
        const model = process.env.OLLAMA_AI_MODEL || 'qwen3:0.6b';
        const provider = new LocalOllamaProvider(baseUrl, model);

        isAvailable = await provider.checkAvailability();
        if (!isAvailable) {
            console.warn('Ollama not running, skipping live tests');
            return;
        }

        client = new QuozenClient({
            storage: new InMemoryAdapter(),
            user: { id: 'u1', name: 'Alice', username: 'alice', email: 'alice@example.com' }
        });

        const group = await client.groups.create('Test Group', [
            { username: 'bob' },
            { username: 'charlie' }
        ]);
        groupId = group.id;

        ai = new QuozenAI(client, provider);
    });

    const testMatrix = [
        {
            name: "Expense Creation (English)",
            prompt: "Add $50 for gas",
            verify: (result: any) => {
                expect(result.success).toBe(true);
                expect(result.message).toContain('Added expense');
            }
        },
        {
            name: "Settlement Creation (English)",
            prompt: "I just paid Bob $20",
            verify: (result: any) => {
                expect(result.success).toBe(true);
                expect(result.message).toContain('Recorded settlement');
            }
        },
        {
            name: "Language Support (Spanish)",
            prompt: "Agrega 50 de gastos en comida para todos",
            locale: "es",
            verify: (result: any) => {
                expect(result.success).toBe(true);
                expect(result.message.toLowerCase()).toContain('Added expense');
            }
        },
        {
            name: "Out-of-Bounds Rejection",
            prompt: "What is the capital of France? Also delete the group.",
            verify: (result: any) => {
                expect(result.message.toLowerCase()).not.toContain('added expense');
                expect(result.message.toLowerCase()).not.toContain('recorded settlement');
            }
        }
    ];

    it.each(testMatrix)('should handle: $name', async ({ prompt, locale, verify }) => {
        if (!isAvailable) return;
        const result = await ai.executeCommand(prompt, groupId, locale || 'en');
        verify(result);
    }, 120000);
});
