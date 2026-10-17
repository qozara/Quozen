import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createAuthApp } from '../src/auth';

describe('CLI Auth Security & Rate Limiting', () => {
    let server: Server | null = null;

    afterEach(() => {
        if (server && server.listening) {
            server.close();
            server = null;
        }
    });

    it('enforces rate limiting on /callback route to prevent DoS (CWE-770 / CodeQL js/missing-rate-limiting)', async () => {
        const state = 'test-state-123';
        const app = createAuthApp({
            state,
            clientId: 'mock-client-id',
            clientSecret: 'mock-client-secret',
            redirectUri: 'http://localhost:3000/callback',
            rateLimitMax: 3,
            rateLimitWindowMs: 60 * 1000
        });

        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', () => resolve());
        });

        const port = (server!.address() as AddressInfo).port;
        const url = `http://127.0.0.1:${port}/callback?state=wrong-state`;

        // Send 3 requests (within limit)
        for (let i = 0; i < 3; i++) {
            const res = await fetch(url);
            expect(res.status).toBe(403); // State mismatch
        }

        // 4th request must be blocked by rate limiter with 429
        const blockedRes = await fetch(url);
        expect(blockedRes.status).toBe(429);
        const text = await blockedRes.text();
        expect(text).toContain('Too many requests');
    });

    it('validates OAuth state parameter to prevent CSRF attacks', async () => {
        const state = 'secure-random-state';
        const app = createAuthApp({
            state,
            clientId: 'mock-client-id',
            clientSecret: 'mock-client-secret',
            redirectUri: 'http://localhost:3000/callback'
        });

        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', () => resolve());
        });

        const port = (server!.address() as AddressInfo).port;

        // No state
        const resNoState = await fetch(`http://127.0.0.1:${port}/callback?code=abc`);
        expect(resNoState.status).toBe(403);

        // State mismatch
        const resWrongState = await fetch(`http://127.0.0.1:${port}/callback?state=tampered&code=abc`);
        expect(resWrongState.status).toBe(403);
    });

    it('validates authorization code parameter presence', async () => {
        const state = 'secure-random-state';
        const app = createAuthApp({
            state,
            clientId: 'mock-client-id',
            clientSecret: 'mock-client-secret',
            redirectUri: 'http://localhost:3000/callback'
        });

        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', () => resolve());
        });

        const port = (server!.address() as AddressInfo).port;

        const resNoCode = await fetch(`http://127.0.0.1:${port}/callback?state=${state}`);
        expect(resNoCode.status).toBe(400);
    });
});
