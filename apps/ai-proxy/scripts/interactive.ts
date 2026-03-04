import * as dotenv from 'dotenv';
import { resolve } from 'path';
import readline from 'readline/promises';
import { agentTools, AgentOrchestrator, Ledger } from '@quozen/core';
import app from '../src/index';

// Load environment variables from .dev.vars
dotenv.config({ path: resolve(process.cwd(), '.dev.vars') });

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const KMS_SECRET = process.env.KMS_SECRET;
const AI_PROVIDER = process.env.AI_PROVIDER || 'google';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api';

// --- FAKE RAG CONTEXT FOR TESTING ---
const MOCK_ME = { id: 'u1', name: 'Diego', email: 'diego@example.com', username: 'diego' };
const MOCK_LEDGER = new Ledger({
    members: [
        { userId: 'u1', name: 'Diego', email: 'diego@example.com', role: 'owner', joinedAt: new Date() },
        { userId: 'u2', name: 'Alice', email: 'alice@example.com', role: 'member', joinedAt: new Date() },
        { userId: 'u3', name: 'Bob', email: 'bob@example.com', role: 'member', joinedAt: new Date() },
    ],
    expenses: [
        { id: 'e1', description: 'Pizza', amount: 30, category: 'food', date: new Date(), paidByUserId: 'u1', splits: [{ userId: 'u1', amount: 10 }, { userId: 'u2', amount: 10 }, { userId: 'u3', amount: 10 }], createdAt: new Date(), updatedAt: new Date() }
    ],
    settlements: []
});

async function discoverGoogleModels(apiKey: string) {
    console.log('\n🔍 Discovering Google Models...');
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        return data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => ({
                name: m.name.split('/').pop(),
                displayName: m.displayName
            }));
    } catch (error) {
        console.error('❌ Error discovering Google models:', error);
        return [];
    }
}

async function discoverOllamaModels(baseUrl: string) {
    console.log(`\n🔍 Discovering Ollama Models at ${baseUrl}...`);
    try {
        const tagsUrl = baseUrl.endsWith('/api') ? `${baseUrl}/tags` : `${baseUrl}/api/tags`;
        const response = await fetch(tagsUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        const data = (await response.json()) as any;
        return data.models.map((m: any) => ({
            name: m.name,
            displayName: `Size: ${(m.size / 1024 / 1024 / 1024).toFixed(2)} GB`
        }));
    } catch (error) {
        console.error('❌ Error discovering Ollama models:', error);
        return [];
    }
}

async function main() {
    console.log(`\n--- Quozen AI Proxy Interactive Test (Provider: ${AI_PROVIDER}) ---`);

    let models: any[] = [];
    if (AI_PROVIDER === 'ollama') {
        models = await discoverOllamaModels(OLLAMA_BASE_URL);
    } else {
        if (!GOOGLE_API_KEY) {
            console.error('❌ Missing GOOGLE_GENERATIVE_AI_API_KEY in .dev.vars');
            process.exit(1);
        }
        models = await discoverGoogleModels(GOOGLE_API_KEY);
    }

    if (models.length === 0) {
        console.warn(`⚠️ No ${AI_PROVIDER} models found. Using default.`);
    } else {
        console.log('\nAvailable Models:');
        models.forEach((m: any, i: number) => {
            console.log(`${i + 1}. ${m.name} (${m.displayName})`);
        });
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    let selectedModel = AI_PROVIDER === 'ollama' ? 'qwen3:0.6b' : 'gemini-2.0-flash';
    if (models.length > 0) {
        const choice = await rl.question(`\nSelect a model (number, default: ${selectedModel}): `);
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < models.length) {
            selectedModel = models[index].name;
        }
    }

    console.log(`\n🚀 Starting Chat Session with model: ${selectedModel}`);
    console.log('--- Context Recap ---');
    console.log(`User: ${MOCK_ME.name} (${MOCK_ME.id})`);
    console.log('Balances:');
    const b = MOCK_LEDGER.getBalances();
    Object.entries(b).forEach(([id, amt]) => console.log(`- ${id}: ${amt}`));
    console.log('---');
    console.log('Type your message to chat, or "exit" to quit.\n');

    const conversationHistory: any[] = [];
    const systemPrompt = AgentOrchestrator.buildSystemPrompt({
        activeGroupId: 'group-123',
        me: MOCK_ME,
        ledger: MOCK_LEDGER
    });

    while (true) {
        const input = await rl.question('You: ');
        if (input.toLowerCase() === 'exit') break;

        conversationHistory.push({ role: 'user', content: input });

        const requestEnv = { ...process.env };
        if (AI_PROVIDER === 'google') {
            requestEnv.GOOGLE_GENERATIVE_AI_MODEL = selectedModel;
        } else {
            requestEnv.OLLAMA_AI_MODEL = selectedModel;
        }

        console.log(`[DEBUG] Context Env: ${AI_PROVIDER === 'google' ? 'GOOGLE_GENERATIVE_AI_MODEL' : 'OLLAMA_AI_MODEL'}=${process.env[AI_PROVIDER === 'google' ? 'GOOGLE_GENERATIVE_AI_MODEL' : 'OLLAMA_AI_MODEL']}`);

        try {
            const res = await app.request(
                '/api/v1/agent/chat',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer mock-test-token',
                    },
                    body: JSON.stringify({
                        messages: conversationHistory,
                        systemPrompt: systemPrompt,
                        tools: agentTools,
                    }),
                },
                process.env // Use current process.env
            );

            if (!res.ok) {
                const error = await res.json();
                console.error('❌ Proxy Error:', error);
                continue;
            }

            const result = (await res.json()) as any;

            console.log('--- Raw Proxy Response ---');
            console.log(JSON.stringify(result, null, 2));
            console.log('--------------------------');

            if (result.type === 'text') {
                console.log(`\nAI: ${result.content}\n`);
                conversationHistory.push({ role: 'assistant', content: result.content });
            } else if (result.type === 'tool_call') {
                const validation = AgentOrchestrator.validateResponse(result);
                if (!validation.isValid) {
                    console.log(`\n❌ Invalid AI Response: ${validation.error}\n`);
                    continue;
                }

                console.log('\n✨ QUOZEN CLIENT INVOCATION:');
                if (result.tool === 'addExpense') {
                    console.log(`   👉 QuozenClient.ledger("group-123").addExpense({`);
                    console.log(`        description: "${result.arguments.description}",`);
                    console.log(`        amount: ${result.arguments.amount},`);
                    console.log(`        paidByUserId: "${result.arguments.paidByUserId}",`);
                    console.log(`        splits: ${JSON.stringify(result.arguments.splits, null, 8)}`);
                    console.log(`      })\n`);
                } else if (result.tool === 'addSettlement') {
                    console.log(`   👉 QuozenClient.ledger("group-123").addSettlement({`);
                    console.log(`        fromUserId: "${result.arguments.fromUserId}",`);
                    console.log(`        toUserId: "${result.arguments.toUserId}",`);
                    console.log(`        amount: ${result.arguments.amount},`);
                    console.log(`        method: "${result.arguments.method || 'Cash'}",`);
                    console.log(`        notes: "${result.arguments.notes || ''}"`);
                    console.log(`      })\n`);
                }

                conversationHistory.push({
                    role: 'assistant',
                    content: `[Tool Call: ${result.tool} with ${JSON.stringify(result.arguments)}]`
                });
            }
        } catch (error) {
            console.error('❌ Request Failed:', error);
        }
    }

    rl.close();
}

main().catch(console.error);
