import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { QuozenClient, GoogleDriveStorageLayer } from '@quozen/core';

const CREDENTIALS_PATH = path.join(os.homedir(), '.quozen', 'credentials.json');

export async function getCredentials() {
    try {
        const data = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

export async function refreshAccessToken(credentials: any) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET for token refresh");
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: credentials.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        throw new Error("Failed to refresh token. Please login again.");
    }

    const tokens = await response.json();
    credentials.access_token = tokens.access_token;
    if (tokens.refresh_token) {
        credentials.refresh_token = tokens.refresh_token;
    }
    credentials.expiry_date = Date.now() + tokens.expires_in * 1000;

    await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    return credentials;
}

export async function getQuozenCliClient() {
    let credentials = await getCredentials();
    if (!credentials) {
        throw new Error("Not logged in. Run 'npm run cli -- login' first.");
    }

    if (Date.now() >= credentials.expiry_date - 60000) {
        credentials = await refreshAccessToken(credentials);
    }

    const storage = new GoogleDriveStorageLayer(() => credentials.access_token);

    return new QuozenClient({
        storage,
        user: credentials.user,
        enableCache: true,
        cacheTtlMs: 60000
    });
}

export async function getAuthToken(): Promise<string | null> {
    const credentials = await getCredentials();
    if (!credentials) return null;
    return credentials.access_token;
}
