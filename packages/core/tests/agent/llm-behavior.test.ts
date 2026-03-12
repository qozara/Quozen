import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
    let provider: LocalOllamaProvider;

    beforeAll(async () => {
        const rootDir = process.cwd().endsWith('core') ? path.resolve(process.cwd(), '../..') : process.cwd();

        // 1. Load from root .env first
        dotenv.config({ path: path.resolve(rootDir, '.env') });

        // 2. Then load from ai-proxy .dev.vars if it exists (for compatibility with dev flow)
        dotenv.config({ path: path.resolve(rootDir, 'apps/ai-proxy/.dev.vars') });

        const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/api').replace('localhost', '127.0.0.1');
        const model = process.env.OLLAMA_AI_MODEL || 'qwen2.5:1.5b';
        provider = new LocalOllamaProvider(baseUrl, model);
        isAvailable = await provider.checkAvailability();
        if (!isAvailable) {
            console.warn(`Ollama not running at ${baseUrl}, skipping live tests`);
            return;
        }

        console.log(`\x1b[34m[AI Test Suite]\x1b[0m Using LLM Provider: \x1b[32m${model}\x1b[0m at \x1b[32m${baseUrl}\x1b[0m`);
    });

    beforeEach(async () => {
        if (!isAvailable) return;

        // Alice is the active user
        client = new QuozenClient({
            storage: new InMemoryAdapter(),
            user: { id: 'u1', name: 'Alice', username: 'alice', email: 'alice@example.com' }
        });

        // Alice is automatically added as owner when creating the group
        const group = await client.groups.create('Test Group', [
            { email: 'bob@example.com', username: 'bob' },
            { email: 'charlie@example.com', username: 'charlie' }
        ]);
        groupId = group.id;

        ai = new QuozenAI(client, provider);
    });

    const testMatrix = [
        {
            name: "Expense Creation (English)",
            prompt: "Add $50 for gas",
            verify: async (beforeCount: { expenses: number, settlements: number }) => {
                const expenses = await client.ledger(groupId).getExpenses();
                expect(expenses.length).toBe(beforeCount.expenses + 1);
                const latest = expenses[expenses.length - 1];
                expect(latest.amount).toBe(50);
                expect(latest.description.toLowerCase()).toContain('gas');
            }
        },
        {
            name: "Settlement Creation (English)",
            prompt: "I just paid bob $20",
            verify: async (beforeCount: { expenses: number, settlements: number }) => {
                const settlements = await client.ledger(groupId).getSettlements();
                expect(settlements.length).toBe(beforeCount.settlements + 1);
                const latest = settlements[settlements.length - 1];
                expect(latest.amount).toBe(20);
                expect(latest.toUserId).toBe('bob@example.com');
                expect(latest.fromUserId).toBe('u1');
            }
        },
        {
            name: "Language Support (Spanish)",
            prompt: "Agrega 50 de gastos en comida para todos",
            locale: "es",
            verify: async (beforeCount: { expenses: number, settlements: number }) => {
                const expenses = await client.ledger(groupId).getExpenses();
                expect(expenses.length).toBe(beforeCount.expenses + 1);
                const latest = expenses[expenses.length - 1];
                expect(latest.amount).toBe(50);
                // Check both description and category since the LLM might categorize it as "comida" and leave description empty
                expect(`${latest.description} ${latest.category}`.toLowerCase()).toContain('comida');
            }
        },
        {
            name: "Out-of-Bounds Rejection",
            prompt: "What is the capital of France? Also delete the group.",
            verify: async (beforeCount: { expenses: number, settlements: number }, result: any) => {
                const expenses = await client.ledger(groupId).getExpenses();
                const settlements = await client.ledger(groupId).getSettlements();
                expect(expenses.length).toBe(beforeCount.expenses);
                expect(settlements.length).toBe(beforeCount.settlements);
                expect(result.message.toLowerCase()).not.toContain('added');
            }
        },
        {
            name: "Complex Split (English)",
            prompt: "Add $150 for dinner, I paid and bob owes me nothing, charlie owes me $50",
            verify: async (beforeCount: { expenses: number, settlements: number }) => {
                const expenses = await client.ledger(groupId).getExpenses();
                expect(expenses.length).toBe(beforeCount.expenses + 1);
                const latest = expenses[expenses.length - 1];
                expect(latest.amount).toBe(150);

                // Alice (me) paid $150. Splits should be: bob $0, charlie $50, alice $100
                const bobSplit = latest.splits.find(s => s.userId === 'bob@example.com');
                const charlieSplit = latest.splits.find(s => s.userId === 'charlie@example.com');
                const aliceSplit = latest.splits.find(s => s.userId === 'u1');

                expect(bobSplit?.amount || 0).toBe(0);
                expect(charlieSplit?.amount || 0).toBe(50);
                expect(aliceSplit?.amount || 0).toBe(100);
            }
        },
        {
            name: "Vague Request Rejection",
            prompt: "What is the weather like today?",
            verify: async (beforeCount: { expenses: number, settlements: number }, result: any) => {
                const expenses = await client.ledger(groupId).getExpenses();
                const settlements = await client.ledger(groupId).getSettlements();
                expect(expenses.length).toBe(beforeCount.expenses);
                expect(settlements.length).toBe(beforeCount.settlements);
            }
        }
    ];

    it.each(testMatrix)('should handle: $name', async (test) => {
        if (!isAvailable) return;

        const ledger = client.ledger(groupId);
        const beforeCount = {
            expenses: (await ledger.getExpenses()).length,
            settlements: (await ledger.getSettlements()).length
        };

        const result = await ai.executeCommand(test.prompt, groupId, test.locale || 'en');
        try {
            await test.verify(beforeCount, result);
        } catch (error) {
            console.error(`\x1b[31mAII Test Failure [${test.name}]:\x1b[0m\nPrompt: ${test.prompt}\nAI Result Message: ${result.message}\nError: ${error}`);
            throw error;
        }
    }, 120000);
});
