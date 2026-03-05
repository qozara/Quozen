import { describe, it, expect, vi } from 'vitest';
import { app } from '../src/index';

describe('Auth Middleware Boundaries', () => {
    it('should return 401 for missing Authorization header', async () => {
        const res = await app.request('/api/v1/groups');
        expect(res.status).toBe(401);
        const data = await res.json() as any;
        expect(data.error).toBe('Unauthorized');
    });

    it('should return 401 for invalid Bearer token format', async () => {
        const res = await app.request('/api/v1/groups', {
            headers: { 'Authorization': 'Basic invalid-token' }
        });
        expect(res.status).toBe(401);
    });

    it('should return 401 for an actual invalid Google token', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ error: 'invalid_token' })
        });

        const res = await app.request('/api/v1/groups', {
            headers: { 'Authorization': 'Bearer some-invalid-google-token' }
        });
        expect(res.status).toBe(401);

        globalThis.fetch = originalFetch;
    });
});
