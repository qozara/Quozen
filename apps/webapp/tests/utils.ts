import { Page, BrowserContext, APIRequestContext, expect } from '@playwright/test';
import { mockServer } from './mock-server';

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
    }
}

/**
 * Initializes the test environment.
 * In Mock Mode: Intercepts network requests to the mock storage API.
 */
export async function setupTestEnvironment(context: BrowserContext) {
    if (isMockMode) {
        await context.route(`${MOCK_API_BASE}/**`, async (route) => {
            await mockServer.handle(route);
        });
    }
}

/**
 * Resets the mock server state.
 */
export async function resetTestState() {
    if (isMockMode) {
        mockServer.reset();
    }
}

/**
 * Waits for the user to be logged in (Real Mode only).
 * Call this after navigating to the app.
 */
export async function ensureLoggedIn(page: Page) {
    if (!isMockMode) {
        console.log("Real Mode: Waiting for user to log in manually (timeout: 5 minutes)...");
        // Wait for a sign that we are logged in, e.g., the 'New Group' button on dashboard
        await expect(page.getByRole('button', { name: 'New Group' })).toBeVisible({ timeout: 300_000 });
        console.log("Real Mode: User logged in.");
    } else {
        // Mock Mode: Wait for app to hydrate and show main layout (Bottom Navigation is a good indicator)
        await expect(page.getByTestId('bottom-navigation')).toBeVisible();
    }
}

/**
 * Gets the access token. 
 * In Mock Mode, returns a static token.
 * In Real Mode, scrapes it from the page (requires manual login).
 */
export async function getAccessToken(page: Page): Promise<string> {
    if (isMockMode) return "mock-token-123";

    // In Real Mode, we wait for it to appear
    const token = await page.evaluate(() => localStorage.getItem("quozen_access_token"));
    if (!token) throw new Error("No access token found in localStorage");
    return token;
}

// --- Unified API Helpers ---

/**
 * Helper to make requests to either Google Drive or Mock API.
 */
async function apiRequest(request: APIRequestContext, method: string, url: string, token: string, body?: any) {
    if (isMockMode) {
        // Direct dispatch to mock server in the same process
        const res = await mockServer.dispatch(method, url, body);

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

export async function findFiles(request: APIRequestContext, token: string, search: string) {
    let url: string;
    if (isMockMode) {
        // Mock API uses q param
        url = `${MOCK_API_BASE}/files?q=${encodeURIComponent(search)}`;
    } else {
        const q = `${search} and trashed = false`;
        url = `${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id, name)`;
    }

    const res = await apiRequest(request, 'GET', url, token);
    const data = await res.json() as any;
    return data.files || [];
}

export async function deleteFile(request: APIRequestContext, token: string, fileId: string) {
    const url = isMockMode
        ? `${MOCK_API_BASE}/files/${fileId}`
        : `${DRIVE_API_URL}/files/${fileId}`;

    await apiRequest(request, 'DELETE', url, token);
}

export async function createEmptySettingsFile(request: APIRequestContext, token: string) {
    if (isMockMode) {
        // In Mock mode, create a FILE that matches the settings name.
        // The App's reconciliation logic will find this file via listFiles.
        const res = await apiRequest(request, 'POST', `${MOCK_API_BASE}/files`, token, {
            name: SETTINGS_FILE_NAME,
            sheetNames: []
        });
        const data = await res.json() as any;
        return data.id;
    } else {
        const metadata = {
            name: SETTINGS_FILE_NAME,
            mimeType: "application/json"
        };
        const res = await apiRequest(request, 'POST', `${DRIVE_API_URL}/files`, token, metadata);
        const data = await res.json() as any;
        return data.id;
    }
}

export async function createDummyGroup(request: APIRequestContext, token: string, name: string) {
    // Ensure consistency: Real mode prepends "Quozen - ", Mock mode should too.
    const fullName = name.startsWith("Quozen - ") ? name : `Quozen - ${name}`;
    const properties = { quozen_type: 'group', version: '1.0' };

    if (isMockMode) {
        const res = await apiRequest(request, 'POST', `${MOCK_API_BASE}/files`, token, {
            name: fullName,
            sheetNames: ["Expenses", "Settlements", "Members"],
            properties: properties // Add properties for strict reconciliation
        });
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
        const res = await apiRequest(request, 'POST', `${DRIVE_API_URL}/files`, token, metadata);
        const data = await res.json() as any;
        const fileId = data.id;

        // 2. Add Properties (Drive API doesn't allow setting properties on CREATE for some file types, safe to do patch)
        await apiRequest(request, 'PATCH', `${DRIVE_API_URL}/files/${fileId}`, token, {
            properties: properties
        });

        return data;
    }
}

export async function fetchFileContent(request: APIRequestContext, token: string, fileId: string) {
    if (isMockMode) {
        const opts = encodeURIComponent(JSON.stringify({ alt: 'media' }));
        const res = await apiRequest(request, 'GET', `${MOCK_API_BASE}/files/${fileId}?options=${opts}`, token);
        const json = await res.json();
        return JSON.stringify(json);
    } else {
        const res = await apiRequest(request, 'GET', `${DRIVE_API_URL}/files/${fileId}?alt=media`, token);
        return await res.text();
    }
}
