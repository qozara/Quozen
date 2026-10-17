import express from 'express';
import open from 'open';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const CREDENTIALS_DIR = path.join(os.homedir(), '.quozen');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'credentials.json');

export async function login() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error("Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.");
        console.error("You need a 'Desktop' OAuth client from Google Cloud Console.");
        process.exit(1);
    }

    const state = crypto.randomUUID();
    const app = express();
    const server = app.listen(3000, '127.0.0.1', () => {
        console.log("Listening on http://127.0.0.1:3000");
    });

    const redirectUri = 'http://localhost:3000/callback';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile%20https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;

    console.log("Opening browser for authentication...");
    await open(authUrl);

    return new Promise<void>((resolve, reject) => {
        app.get('/callback', async (req, res) => {
            const receivedState = req.query.state as string;
            const code = req.query.code as string;

            if (!receivedState || receivedState !== state) {
                res.status(403).send("Authentication failed! State mismatch (CSRF protection).");
                server.close();
                return reject(new Error("OAuth state mismatch"));
            }

            if (!code) {
                res.status(400).send("Authentication failed! No code received.");
                server.close();
                return reject(new Error("No code received"));
            }

            res.send("Authentication successful! You can close this tab.");

            try {
                const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code,
                        client_id: clientId,
                        client_secret: clientSecret,
                        redirect_uri: redirectUri,
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

                await fs.mkdir(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
                await fs.writeFile(CREDENTIALS_PATH, JSON.stringify({
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
                server.close();
                resolve();
            } catch (err) {
                console.error("Error during token exchange", err);
                server.close();
                reject(err);
            }
        });
    });
}
