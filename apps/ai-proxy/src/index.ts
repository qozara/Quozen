import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from 'hono/adapter';
import { generateText, jsonSchema } from 'ai';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { authMiddleware, AppEnv } from './middleware/auth';
import { encrypt, decrypt } from './lib/kms';
import { ProviderFactory } from './providers/factory';
import { z } from 'zod';

const ChatRequestSchema = z.object({
    messages: z.array(z.any()),
    systemPrompt: z.string().optional(),
    tools: z.array(z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.any(),
    })).optional(),
    ciphertext: z.string().optional(),
});

const EncryptRequestSchema = z.object({
    apiKey: z.string(),
});


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
    const body = await c.req.json();
    const validation = EncryptRequestSchema.safeParse(body);

    if (!validation.success) {
        return c.json({
            error: 'Bad Request',
            message: 'Invalid request body',
            issues: validation.error.issues
        }, 400);
    }

    const { apiKey } = validation.data;

    const { KMS_SECRET } = (c.env || env(c)) as AppEnv['Bindings'];

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
    const body = await c.req.json();
    const requestValidation = ChatRequestSchema.safeParse(body);

    if (!requestValidation.success) {
        return c.json({
            error: 'Bad Request',
            message: 'Invalid request body',
            issues: requestValidation.error.issues
        }, 400);
    }

    const { messages, systemPrompt, tools, ciphertext } = requestValidation.data;

    const user = c.get('user');
    // Use c.env if available (common in tests/Cloudflare), otherwise fall back to adapter env
    const bindings = (c.env || env(c)) as AppEnv['Bindings'];
    const providerId = bindings.AI_PROVIDER || 'google';

    const provider = ProviderFactory.getProvider(providerId);

    if (!provider) {
        return c.json({ error: 'Not Found', message: `AI Provider '${providerId}' not supported` }, 404);
    }

    let activeApiKey: string | undefined;

    if (ciphertext) {
        const { KMS_SECRET } = bindings;
        if (!KMS_SECRET) {
            return c.json({ error: 'Internal Server Error', message: 'KMS_SECRET not configured' }, 500);
        }
        try {
            activeApiKey = await decrypt(ciphertext, KMS_SECRET);
        } catch (error) {
            return c.json({ error: 'Bad Request', message: 'Invalid ciphertext' }, 400);
        }
    } else if (provider.isCloud) {
        // Rate limiting for Team Key (only if KV is configured)
        const { KV_REST_API_URL, KV_REST_API_TOKEN, AI_RATE_LIMIT_REQUESTS = '20', AI_RATE_LIMIT_WINDOW = '1 d' } = bindings;
        if (KV_REST_API_URL && KV_REST_API_TOKEN) {
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

    // Get config from provider (falls back to team config if no ciphertext)
    const providerConfig = provider.getTeamConfig(bindings);
    if (activeApiKey) {
        providerConfig.apiKey = activeApiKey;
    }

    const validation = provider.validateConfig(providerConfig);
    if (!validation.isValid) {
        return c.json({ error: 'Internal Server Error', message: validation.error || 'Invalid LLM configuration' }, 500);
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
        const modelInstance = provider.getLanguageModel(providerConfig);
        console.log(`🚀 LLM Request: Provider=${provider.id}, Model=${providerConfig.model}`);

        const result = await generateText({
            model: modelInstance,
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
            message: 'LLM request failed'
        }, 500);
    }
});

export default app;
