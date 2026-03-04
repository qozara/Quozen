import { Context, Next } from 'hono';
import { QuozenClient, GoogleDriveStorageLayer, InMemoryAdapter, validateGoogleToken, User } from '@quozen/core';

// Strongly type our Hono Context so handlers know about injected variables
export type AppEnv = {
    Variables: {
        user: User;
        quozen: QuozenClient;
    };
    Bindings: {
        NODE_ENV: string;
    };
};

// Persist memory adapter across test requests
const testStorage = new InMemoryAdapter();

export const authMiddleware = async (c: Context<AppEnv>, next: Next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');

    // Phase 6 Readiness: Support for Vitest isolated testing (strictly limited to non-production)
    if (token === 'mock-test-token') {
        const env = (c.env as any)?.NODE_ENV || 'production';
        const isTest = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.env?.NODE_ENV === 'test';
        const isDev = env === 'development';

        if (isTest || isDev) {
            const user: User = { id: 'u1', email: 'test@quozen.com', name: 'Test User', username: 'testuser' };
            c.set('user', user);
            c.set('quozen', new QuozenClient({ storage: testStorage, user }));
            return next();
        }
    }

    try {
        const user = await validateGoogleToken(token);
        const storage = new GoogleDriveStorageLayer(() => token);
        const client = new QuozenClient({ storage, user });

        c.set('user', user);
        c.set('quozen', client);

        await next();
    } catch (error: any) {
        if (error.message === 'Invalid Google token') {
            return c.json({ error: 'Unauthorized', message: 'Invalid Google token' }, 401);
        }
        return c.json({ error: 'Internal Server Error', message: 'Failed to authenticate token' }, 500);
    }
};
