import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from 'hono/adapter';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, jsonSchema } from 'ai';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { authMiddleware, AppEnv } from './middleware/auth';
import { encrypt, decrypt } from './lib/kms';

const app = new Hono<AppEnv>();

app.use('*', cors());

app.get('/', (c) => {
    return c.text('Quozen AI Proxy is Running');
});

app.get('/health', (c) => {
    return c.text('OK');
});

app.use('/api/*', authMiddleware);

app.post('/api/v1/agent/encrypt', async (c) => {
    const { apiKey } = await c.req.json();

    if (!apiKey) {
        return c.json({ error: 'Bad Request', message: 'Missing apiKey' }, 400);
    }

    const { KMS_SECRET } = env(c);

    if (!KMS_SECRET) {
        return c.json({ error: 'Internal Server Error', message: 'KMS_SECRET not configured' }, 500);
    }

    try {
        const ciphertext = await encrypt(apiKey, KMS_SECRET);
        return c.json({ ciphertext });
    } catch (error) {
        return c.json({ error: 'Internal Server Error', message: 'Encryption failed' }, 500);
    }
});

app.post('/api/v1/agent/chat', async (c) => {
    const { messages, systemPrompt, tools, ciphertext } = await c.req.json();
    const user = c.get('user');
    const { GOOGLE_GENERATIVE_AI_API_KEY, KMS_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN } = env(c);

    let activeApiKey = GOOGLE_GENERATIVE_AI_API_KEY;

    if (ciphertext) {
        if (!KMS_SECRET) {
            return c.json({ error: 'Internal Server Error', message: 'KMS_SECRET not configured' }, 500);
        }
        try {
            activeApiKey = await decrypt(ciphertext, KMS_SECRET);
        } catch (error) {
            return c.json({ error: 'Bad Request', message: 'Invalid ciphertext' }, 400);
        }
    } else {
        // Rate limiting for Team Key (only if KV is configured)
        if (KV_REST_API_URL && KV_REST_API_TOKEN) {
            const { AI_RATE_LIMIT_REQUESTS = '20', AI_RATE_LIMIT_WINDOW = '1 d' } = env(c);
            const redis = new Redis({
                url: KV_REST_API_URL,
                token: KV_REST_API_TOKEN,
            });
            const ratelimit = new Ratelimit({
                redis,
                limiter: Ratelimit.slidingWindow(parseInt(AI_RATE_LIMIT_REQUESTS), AI_RATE_LIMIT_WINDOW as any),
            });
            const { success } = await ratelimit.limit(`ai-limit:${user.id}`);
            if (!success) {
                return c.json({ error: 'Too Many Requests', message: 'Daily limit exceeded' }, 429);
            }
        }
    }

    if (!activeApiKey) {
        return c.json({ error: 'Internal Server Error', message: 'LLM API Key not configured' }, 500);
    }

    // Format tools from frontend (array) to SDK format (object with jsonSchema)
    const formattedTools: Record<string, any> = {};
    if (Array.isArray(tools)) {
        tools.forEach((tool: any) => {
            formattedTools[tool.name] = {
                description: tool.description,
                parameters: jsonSchema(tool.parameters)
            };
        });
    }

    try {
        const { GOOGLE_GENERATIVE_AI_MODEL = 'gemini-2.0-flash' } = env(c);
        console.log(`Using AI Model: ${GOOGLE_GENERATIVE_AI_MODEL}`);
        const googleInstance = createGoogleGenerativeAI({
            apiKey: activeApiKey,
        });

        const result = await generateText({
            model: googleInstance(GOOGLE_GENERATIVE_AI_MODEL),
            system: systemPrompt,
            messages,
            tools: formattedTools,
            maxRetries: 0
        });

        if (result.toolCalls && result.toolCalls.length > 0) {
            const call = result.toolCalls[0];
            return c.json({
                type: 'tool_call',
                tool: call.toolName,
                arguments: call.args
            });
        }

        return c.json({
            type: 'text',
            content: result.text
        });
    } catch (error: any) {
        console.error('LLM Error:', error);
        return c.json({
            error: 'Internal Server Error',
            message: error.message || 'LLM request failed'
        }, 500);
    }
});

export default app;
