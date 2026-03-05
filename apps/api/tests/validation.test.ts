import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

describe('API Validation', () => {
    it('POST /api/v1/groups should return 400 when member email is invalid', async () => {
        const payload = {
            name: 'Invalid Email Group',
            members: [
                { email: 'not-an-email' }
            ]
        };
        const res = await app.request('/api/v1/groups', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        expect(res.status).toBe(400);
        // Hono returns a Zod error in the response when using c.req.valid('json')
    });

    it('POST /api/v1/groups should return 201 when member email is valid', async () => {
        const payload = {
            name: 'Valid Email Group',
            members: [
                { email: 'test@example.com' }
            ]
        };
        const res = await app.request('/api/v1/groups', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer mock-test-token', 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        expect(res.status).toBe(201);
    });
});
