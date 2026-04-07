import { Page, BrowserContext, APIRequestContext, expect } from '@playwright/test';
import { MockServer } from './mock-server';
import fs from 'fs';
import path from 'path';
import os from 'os';

const mockValue = process.env.VITE_USE_MOCK_STORAGE;
export const isMockMode = mockValue === 'true' || mockValue === 'remote';
if (process.env.DEBUG_MOCK === 'true') {
    console.log(`[TestMode] isMockMode: ${isMockMode}`);
}

const SETTINGS_FILE_NAME = "quozen-settings.json";
const DRIVE_API_URL = "https://www.googleapis.com/drive/v3";
const MOCK_API_BASE = "/_test/storage";

/**
 * Sets up authentication based on the current mode.
 * Throws a clear error if running cloud tests without local credentials.
 */
export async function setupAuth(page: Page) {
    if (isMockMode) {
        await page.addInitScript(() => {
            localStorage.setItem("quozen_access_token", "mock-token-123");
            localStorage.setItem("quozen_user_profile", JSON.stringify({
                id: "test-user-id",
                username: "test@example.com",
                email: "test@example.com",
                name: "Test User",
                picture: "https://via.placeholder.com/150"
            }));
        });
    } else {
        const credsPath = path.join(os.homedir(), '.quozen', 'credentials.json');

        // 🚨 SANITY CHECK: Ensure credentials exist before running real cloud tests
        if (!fs.existsSync(credsPath)) {
            throw new Error(`
❌ CRITICAL ERROR: Local Google credentials not found!
You are attempting to run tests against the real Google Drive API, but you are not logged in.

Please open a terminal and run the following command to authenticate:
👉 npm run cli -- login

Once complete, run the tests again.
            `);
        }

        let creds;
        try {
            creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
            if (!creds.access_token || !creds.refresh_token) throw new Error("Invalid format");
        } catch (e) {
            throw new Error(`❌ CRITICAL ERROR: credentials.json is corrupted. Please run 'npm run cli -- login' again.`);
        }

        if (Date.now() >= creds.expiry_date - 60000) {
            console.log("Refreshing Google OAuth token...");
            const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            if (!clientId || !clientSecret) throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET for token refresh");

            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: creds.refresh_token,
                    grant_type: 'refresh_token'
                })
            });

            if (!response.ok) throw new Error(`❌ Failed to refresh token. Please run 'npm run cli -- login' again.`);
            const tokens = await response.json();
            creds.access_token = tokens.access_token;
            if (tokens.refresh_token) creds.refresh_token = tokens.refresh_token;
            creds.expiry_date = Date.now() + tokens.expires_in * 1000;
            fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
        }

        const token = creds.access_token;
        const profile = JSON.stringify(creds.user);

        await page.addInitScript(({ token, profile }) => {
            localStorage.setItem("quozen_access_token", token);
            localStorage.setItem("quozen_user_profile", profile);
        }, { token, profile });
    }
}

/**
 * Initializes the test environment.
 * In Mock Mode: Intercepts network requests to the mock storage API.
 */
export async function setupTestEnvironment(context: BrowserContext, mockServerInstance?: MockServer) {
    if (isMockMode && mockServerInstance) {
        await context.route(`${MOCK_API_BASE}/**`, async (route) => {
            await mockServerInstance.handle(route);
        });
    }
}

/**
 * Waits for the user to be logged in.
 * Call this after navigating to the app.
 */
export async function ensureLoggedIn(page: Page) {
    // Wait for app to hydrate and show main layout (Bottom Navigation is a good indicator)
    await expect(page.getByTestId('bottom-navigation')).toBeVisible();
}

/**
 * Gets the access token. 
 * In Mock Mode, returns a static token.
 * In Real Mode, scrapes it from the page.
 */
export async function getAccessToken(page: Page): Promise<string> {
    if (isMockMode) return "mock-token-123";

    const token = await page.evaluate(() => localStorage.getItem("quozen_access_token"));
    if (!token) throw new Error("No access token found in localStorage");
    return token;
}

// --- Unified API Helpers ---

/**
 * Helper to make requests to either Google Drive or Mock API.
 */
async function apiRequest(request: APIRequestContext, method: string, url: string, token: string, body?: any, mockServerInstance?: MockServer) {
    if (isMockMode && mockServerInstance) {
        // Direct dispatch to mock server in the same process
        const res = await mockServerInstance.dispatch(method, url, body);

        return {
            ok: () => res.status >= 200 && res.status < 300,
            status: () => res.status,
            json: async () => res.body,
            text: async () => JSON.stringify(res.body)
        };
    }

    const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
    };

    // If URL starts with /, append to baseURL (Mock). Otherwise absolute (Google).
    const response = await request.fetch(url, {
        method,
        headers,
        data: body
    });

    if (!response.ok()) {
        const text = await response.text();
        // Ignore 404 for delete
        if (method === 'DELETE' && response.status() === 404) return response;
        throw new Error(`API Error ${response.status()}: ${text}`);
    }
    return response;
}

export async function findFiles(request: APIRequestContext, token: string, search: string, mockServerInstance?: MockServer) {
    let url: string;
    if (isMockMode) {
        // Mock API uses q param
        url = `${MOCK_API_BASE}/files?q=${encodeURIComponent(search)}`;
    } else {
        const q = `${search} and trashed = false`;
        url = `${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id, name)`;
    }

    const res = await apiRequest(request, 'GET', url, token, undefined, mockServerInstance);
    const data = await res.json() as any;
    return data.files || [];
}

export async function deleteFile(request: APIRequestContext, token: string, fileId: string, mockServerInstance?: MockServer) {
    const url = isMockMode
        ? `${MOCK_API_BASE}/files/${fileId}`
        : `${DRIVE_API_URL}/files/${fileId}`;

    await apiRequest(request, 'DELETE', url, token, undefined, mockServerInstance);
}

export async function createEmptySettingsFile(request: APIRequestContext, token: string, mockServerInstance?: MockServer) {
    if (isMockMode) {
        // In Mock mode, create a FILE that matches the settings name.
        // The App's reconciliation logic will find this file via listFiles.
        const res = await apiRequest(request, 'POST', `${MOCK_API_BASE}/files`, token, {
            name: SETTINGS_FILE_NAME,
            sheetNames: []
        }, mockServerInstance);
        const data = await res.json() as any;
        return data.id;
    } else {
        const metadata = {
            name: SETTINGS_FILE_NAME,
            mimeType: "application/json"
        };
        const res = await apiRequest(request, 'POST', `${DRIVE_API_URL}/files`, token, metadata, mockServerInstance);
        const data = await res.json() as any;
        return data.id;
    }
}

export async function createDummyGroup(request: APIRequestContext, token: string, name: string, mockServerInstance?: MockServer) {
    // Ensure consistency: Real mode prepends "Quozen - ", Mock mode should too.
    const fullName = name.startsWith("Quozen - ") ? name : `Quozen - ${name}`;
    const properties = { quozen_type: 'group', version: '1.0' };

    if (isMockMode) {
        const res = await apiRequest(request, 'POST', `${MOCK_API_BASE}/files`, token, {
            name: fullName,
            sheetNames: ["Expenses", "Settlements", "Members"],
            properties: properties // Add properties for strict reconciliation
        }, mockServerInstance);
        const data = await res.json() as any;
        const id = data.id;
        return { id, name: fullName };
    } else {
        // Real Drive API
        // 1. Create Spreadsheet
        const metadata = {
            name: fullName,
            mimeType: "application/vnd.google-apps.spreadsheet"
        };
        const res = await apiRequest(request, 'POST', `${DRIVE_API_URL}/files`, token, metadata, mockServerInstance);
        const data = await res.json() as any;
        const fileId = data.id;

        // 2. Add Properties (Drive API doesn't allow setting properties on CREATE for some file types, safe to do patch)
        await apiRequest(request, 'PATCH', `${DRIVE_API_URL}/files/${fileId}`, token, {
            properties: properties
        }, mockServerInstance);

        return data;
    }
}

export async function fetchFileContent(request: APIRequestContext, token: string, fileId: string, mockServerInstance?: MockServer) {
    if (isMockMode) {
        const opts = encodeURIComponent(JSON.stringify({ alt: 'media' }));
        const res = await apiRequest(request, 'GET', `${MOCK_API_BASE}/files/${fileId}?options=${opts}`, token, undefined, mockServerInstance);
        const json = await res.json();
        return JSON.stringify(json);
    } else {
        const res = await apiRequest(request, 'GET', `${DRIVE_API_URL}/files/${fileId}?alt=media`, token, undefined, mockServerInstance);
        return await res.text();
    }
}
