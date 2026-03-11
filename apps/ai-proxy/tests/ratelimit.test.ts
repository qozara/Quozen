import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';

const { mockLimit } = vi.hoisted(() => ({
    mockLimit: vi.fn().mockResolvedValue({ success: true })
}));

// Redis must be mocked as a proper class because the source code calls `new Redis(...)`.
vi.mock('@upstash/redis', () => ({
    Redis: class {
        constructor() {}
    },
}));

vi.mock('@upstash/ratelimit', () => {
    class Ratelimit {
        limit = mockLimit;
        constructor() {}
        static slidingWindow = vi.fn();
    }
    return { Ratelimit };
});

// Mock AI SDK to avoid actual calls
vi.mock('ai', () => ({
    generateText: vi.fn().mockResolvedValue({
        text: 'AI response',
        toolCalls: []
    }),
    jsonSchema: vi.fn(),
}));

// Mock the Google AI SDK so ProviderFactory doesn't fail to build the model
vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));

describe('AI Proxy Rate Limiting', () => {
    const ENV = {
        NODE_ENV: 'test',
        KMS_SECRET: '0123456789abcdef0123456789abcdef',
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-api-key',
        KV_REST_API_URL: 'https://mock-kv.upstash.io',
        KV_REST_API_TOKEN: 'mock-token',
        AI_RATE_LIMIT_REQUESTS: '2',
        AI_RATE_LIMIT_WINDOW: '1 d'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockLimit.mockResolvedValue({ success: true });
    });

    it('should return 429 when rate limit is exceeded', async () => {
        mockLimit.mockResolvedValue({ success: false });

        const res = await app.request('/api/v1/agent/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock-test-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'hello' }]
            })
        }, ENV);

        if (res.status !== 429) {
            console.error('Rate Limit Test Failure:', await res.json());
        }
        expect(res.status).toBe(429);
        const data = await res.json() as any;
        expect(data.error).toBe('Too Many Requests');
        expect(data.message).toBe('Daily limit exceeded');
    });

    it('should return 200 when rate limit is NOT exceeded', async () => {
        mockLimit.mockResolvedValue({ success: true });

        const res = await app.request('/api/v1/agent/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock-test-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'hello' }]
            })
        }, ENV);

        expect(res.status).toBe(200);
    });

    it('should BYPASS rate limiting if ciphertext is provided (BYOK)', async () => {
        // First encrypt a key to get a valid ciphertext
        const encRes = await app.request('/api/v1/agent/encrypt', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: 'personal-key' })
        }, ENV);
        const { ciphertext } = await encRes.json() as any;

        const res = await app.request('/api/v1/agent/chat', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock-test-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'hello' }],
                ciphertext
            })
        }, ENV);

        expect(res.status).toBe(200);
        expect(mockLimit).not.toHaveBeenCalled();
    });
});
