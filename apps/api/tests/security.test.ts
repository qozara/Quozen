import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../src/index';

declare const process: any;

describe('API Security, Hardening & Broken Access Control Tests', () => {
    const originalEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    afterEach(() => {
        if (typeof process !== 'undefined' && process.env) {
            process.env.NODE_ENV = originalEnv;
        }
    });

    it('sets critical HTTP security headers (nosniff, X-Frame-Options, Referrer-Policy)', async () => {
        const res = await app.request('/api/openapi.json', {
            method: 'GET'
        });

        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('x-frame-options')).toMatch(/DENY|SAMEORIGIN/);
        expect(res.headers.get('referrer-policy')).toBeTruthy();
    });

    it('handles CORS requests and restricts access properly', async () => {
        const res = await app.request('/api/v1/groups', {
            method: 'OPTIONS',
            headers: {
                'Origin': 'http://localhost:5173',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization, Content-Type'
            }
        });

        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
        expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    });

    it('rejects mock-test-token when NODE_ENV is production', async () => {
        if (typeof process !== 'undefined' && process.env) {
            process.env.NODE_ENV = 'production';
        }
        const res = await app.request('/api/v1/groups', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer mock-test-token'
            }
        });

        // In production, mock-test-token must be rejected as invalid token
        expect(res.status).toBe(401);
    });

    it('rejects negative amount in POST /api/v1/groups/{id}/expenses with 400 Bad Request', async () => {
        if (typeof process !== 'undefined' && process.env) {
            process.env.NODE_ENV = 'test';
        }
        const res = await app.request('/api/v1/groups/grp-1/expenses', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock-test-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: 'Negative expense attack',
                amount: -100,
                category: 'Food',
                date: '2026-10-16T12:00:00Z',
                paidByUserId: 'u1'
            })
        });

        expect(res.status).toBe(400);
    });

    it('rejects negative amount in POST /api/v1/groups/{id}/settlements with 400 Bad Request', async () => {
        if (typeof process !== 'undefined' && process.env) {
            process.env.NODE_ENV = 'test';
        }
        const res = await app.request('/api/v1/groups/grp-1/settlements', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock-test-token',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fromUserId: 'u1',
                toUserId: 'u2',
                amount: -50,
                date: '2026-10-16T12:00:00Z'
            })
        });

        expect(res.status).toBe(400);
    });
});
