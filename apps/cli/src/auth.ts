import express from 'express';
import rateLimit from 'express-rate-limit';
import open from 'open';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CREDENTIALS_DIR = path.join(os.homedir(), '.quozen');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'credentials.json');

export interface AuthAppOptions {
    state: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    credentialsDir?: string;
    credentialsPath?: string;
    rateLimitMax?: number;
    rateLimitWindowMs?: number;
    onSuccess?: () => void;
    onError?: (err: Error) => void;
}

export function createAuthApp(options: AuthAppOptions, server?: { close: () => void }) {
    const app = express();

    // Configure rate limiter to mitigate DoS / brute-force attacks (CWE-770 / CodeQL js/missing-rate-limiting)
    const limiter = rateLimit({
        windowMs: options.rateLimitWindowMs ?? 15 * 60 * 1000, // 15 minutes
        max: options.rateLimitMax ?? 10, // Max 10 attempts per window
        limit: options.rateLimitMax ?? 10,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: 'Too many requests, please try again later.'
    });

    app.use(limiter);

    const credentialsDir = options.credentialsDir ?? CREDENTIALS_DIR;
    const credentialsPath = options.credentialsPath ?? CREDENTIALS_PATH;

    app.get('/callback', async (req, res) => {
        const receivedState = req.query.state as string;
        const code = req.query.code as string;

        if (!receivedState || receivedState !== options.state) {
            res.status(403).send("Authentication failed! State mismatch (CSRF protection).");
            server?.close();
            options.onError?.(new Error("OAuth state mismatch"));
            return;
        }

        if (!code) {
            res.status(400).send("Authentication failed! No code received.");
            server?.close();
            options.onError?.(new Error("No code received"));
            return;
        }

        res.send("Authentication successful! You can close this tab.");

        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: options.clientId,
                    client_secret: options.clientSecret,
                    redirect_uri: options.redirectUri,
                    grant_type: 'authorization_code'
                })
            });

            if (!tokenResponse.ok) {
                throw new Error("Failed to exchange token");
            }

            const tokens = await tokenResponse.json() as any;

            const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokens.access_token}` }
            });
            if (!userResponse.ok) {
                throw new Error("Failed to fetch user info");
            }
            const userInfo = await userResponse.json() as any;

            await fs.mkdir(credentialsDir, { recursive: true, mode: 0o700 });
            await fs.writeFile(credentialsPath, JSON.stringify({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: Date.now() + tokens.expires_in * 1000,
                user: {
                    id: userInfo.sub,
                    email: userInfo.email,
                    name: userInfo.name,
                    username: userInfo.email
                }
            }, null, 2), { mode: 0o600 });

            console.log("Authentication successful and credentials saved.");
            server?.close();
            options.onSuccess?.();
        } catch (err: any) {
            console.error("Error during token exchange", err);
            server?.close();
            options.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
    });

    return app;
}

export async function login() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error("Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.");
        console.error("You need a 'Desktop' OAuth client from Google Cloud Console.");
        process.exit(1);
    }

    const state = crypto.randomUUID();
    const redirectUri = 'http://localhost:3000/callback';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile%20https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;

    return new Promise<void>((resolve, reject) => {
        let server: ReturnType<typeof app.listen>;
        const app = createAuthApp({
            state,
            clientId,
            clientSecret,
            redirectUri,
            onSuccess: resolve,
            onError: reject
        }, {
            close: () => server?.close()
        });

        server = app.listen(3000, '127.0.0.1', async () => {
            console.log("Listening on http://127.0.0.1:3000");
            console.log("Opening browser for authentication...");
            try {
                await open(authUrl);
            } catch {
                console.error("Failed to open browser automatically. Please open this URL manually:", authUrl);
            }
        });
    });
}
