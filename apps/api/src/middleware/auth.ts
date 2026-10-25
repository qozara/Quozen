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

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
    }

    // Support for Vitest isolated testing (strictly limited to test environment)
    if (token === 'mock-test-token') {
        const isTest = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.env?.NODE_ENV === 'test';

        if (isTest) {
            const user: User = { id: 'u1', email: 'test@example.com', name: 'Test User', username: 'testuser' };
            c.set('user', user);
            c.set('quozen', new QuozenClient({ storage: testStorage, user }));
            return next();
        }
        return c.json({ error: 'Unauthorized', message: 'Invalid Google token' }, 401);
    }

    try {
        const user = await validateGoogleToken(token);
        const storage = new GoogleDriveStorageLayer(() => token);
        const client = new QuozenClient({ storage, user });

        c.set('user', user);
        c.set('quozen', client);

        await next();
    } catch (error: any) {
        if (error.message?.includes('token') || error.message?.includes('Google Auth Failed')) {
            return c.json({ error: 'Unauthorized', message: 'Invalid Google token' }, 401);
        }
        return c.json({ error: 'Internal Server Error', message: 'Failed to authenticate token' }, 500);
    }
};
