import * as dotenv from 'dotenv';
import { resolve } from 'path';
import readline from 'readline/promises';
import app from '../src/index';

// Load environment variables from .dev.vars
dotenv.config({ path: resolve(process.cwd(), '.dev.vars') });

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const KMS_SECRET = process.env.KMS_SECRET;
const AI_PROVIDER = process.env.AI_PROVIDER || 'google';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api';

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
        // Ollama tags endpoint is usually at /api/tags
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

    let selectedModel = AI_PROVIDER === 'ollama' ? 'llama3.2' : 'gemini-2.0-flash';
    if (models.length > 0) {
        const choice = await rl.question(`\nSelect a model (number, default: ${selectedModel}): `);
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < models.length) {
            selectedModel = models[index].name;
        }
    }

    console.log(`\n🚀 Starting Chat Session with model: ${selectedModel}`);
    console.log('Type your message to chat, or "exit" to quit.\n');

    const conversationHistory: any[] = [];

    while (true) {
        const input = await rl.question('You: ');
        if (input.toLowerCase() === 'exit') break;

        conversationHistory.push({ role: 'user', content: input });

        // Simulate Hono request
        const env = {
            AI_PROVIDER: AI_PROVIDER,
            OLLAMA_BASE_URL: OLLAMA_BASE_URL,
            GOOGLE_GENERATIVE_AI_API_KEY: GOOGLE_API_KEY,
            GOOGLE_GENERATIVE_AI_MODEL: selectedModel,
            KMS_SECRET: KMS_SECRET,
        };

        try {
            const res = await app.request(
                '/api/v1/agent/chat',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer mock-test-token', // Bypass auth middleware
                    },
                    body: JSON.stringify({
                        messages: conversationHistory,
                        systemPrompt: 'You are a helpful assistant for the Quozen app.',
                        tools: [],
                    }),
                },
                env
            );

            if (!res.ok) {
                const error = await res.json();
                console.error('❌ Proxy Error:', error);
                continue;
            }

            const result = (await res.json()) as any;
            if (result.type === 'text') {
                console.log(`\nAI: ${result.content}\n`);
                conversationHistory.push({ role: 'assistant', content: result.content });
            } else if (result.type === 'tool_call') {
                console.log(`\n🛠️ Tool Call: ${result.tool}`);
                console.log(`Arguments: ${JSON.stringify(result.arguments, null, 2)}\n`);
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
