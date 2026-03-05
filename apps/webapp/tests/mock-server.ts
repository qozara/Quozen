import { Route, Request } from '@playwright/test';
import { InMemoryAdapter } from '@quozen/core';

// Polyfill crypto for Node environment if needed
if (typeof self === 'undefined') {
    (global as any).self = global;
}
if (!global.crypto) {
    (global as any).crypto = require('crypto');
}

class MockServer {
    private adapter: InMemoryAdapter;
    /** Latency to add to every response (ms). 0 = no latency. */
    private _latencyMs: number = 0;
    /** If set, the next request will fail with this status code and then be cleared. */
    private _forcedErrorStatus: number | null = null;

    constructor() {
        this.adapter = new InMemoryAdapter();
    }

    /**
     * T1: Chaos Testing — Inject a fixed latency into all subsequent responses.
     * Call with 0 to disable.
     */
    simulateLatency(ms: number): this {
        this._latencyMs = ms;
        return this;
    }

    /**
     * T1: Chaos Testing — Force the NEXT request to fail with the given HTTP
     * status code (e.g. 409, 403, 500). The override is consumed after one use.
     */
    forceNextError(statusCode: number): this {
        this._forcedErrorStatus = statusCode;
        return this;
    }

    reset() {
        this.adapter = new InMemoryAdapter();
        this._latencyMs = 0;
        this._forcedErrorStatus = null;
    }

    async handle(route: Route) {
        const request = route.request();
        const body = request.postDataJSON();

        try {
            // T1: Inject forced error before any real dispatch
            if (this._forcedErrorStatus !== null) {
                const status = this._forcedErrorStatus;
                this._forcedErrorStatus = null; // consume
                if (this._latencyMs > 0) {
                    await new Promise((r) => setTimeout(r, this._latencyMs));
                }
                const errorBodies: Record<number, object> = {
                    409: { error: 'Conflict', message: 'Data has been modified by another user.' },
                    403: { error: 'Forbidden', message: 'You do not have permission to perform this action.' },
                    429: { error: 'Too Many Requests', message: 'Rate limit exceeded.' },
                    500: { error: 'Internal Server Error', message: 'An unexpected error occurred.' },
                };
                await route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify(errorBodies[status] ?? { error: 'Error', message: `HTTP ${status}` }),
                });
                return;
            }

            const response = await this.dispatch(request.method(), request.url(), body);

            // T1: Apply simulated latency
            if (this._latencyMs > 0) {
                await new Promise((r) => setTimeout(r, this._latencyMs));
            }

            await route.fulfill({
                status: response.status,
                contentType: 'application/json',
                body: JSON.stringify(response.body)
            });
        } catch (e: any) {
            console.error("Mock Server Route Error:", e);
            await route.fulfill({ status: 500, body: e.message });
        }
    }

    async dispatch(method: string, urlStr: string, body: any): Promise<{ status: number, body: any }> {
        const url = new URL(urlStr, 'http://localhost'); // Ensure base if relative
        const path = url.pathname.replace('/_test/storage', '');

        let result: any;

        // --- Files ---
        if (path === '/files') {
            if (method === 'POST') {
                const sheetNames = body.sheetNames || body.sheetTitles || [];
                const id = await this.adapter.createFile(body.name, sheetNames, body.properties, body.content);
                result = { id };
            } else if (method === 'GET') {
                const q = url.searchParams.get('q');
                result = { files: await this.adapter.listFiles(q || "") };
            }
        }
        else if (path.match(/\/files\/[^\/]+$/)) {
            // /files/:id
            const id = path.split('/')[2];
            if (method === 'DELETE') {
                await this.adapter.deleteFile(id);
                result = { success: true };
            } else if (method === 'PATCH') {
                if (body && (body.metadata || body.content)) {
                    result = await this.adapter.updateFile(id, body.metadata, body.content);
                } else {
                    await this.adapter.renameFile(id, body.name);
                    result = { success: true };
                }
            } else if (method === 'GET') {
                const optionsParam = url.searchParams.get('options');
                let options: any = {};
                if (optionsParam) try { options = JSON.parse(optionsParam); } catch { }
                result = await this.adapter.getFile(id, options);
            }
        }
        else if (path.match(/\/files\/[^\/]+\/permissions$/)) {
            const id = path.split('/')[2];
            if (method === 'GET') {
                result = { permissions: await this.adapter.listPermissions(id) };
            } else if (method === 'POST') {
                if (body.access) {
                    await this.adapter.setFilePermissions(id, body.access);
                    result = { success: true };
                } else {
                    result = await this.adapter.createPermission(id, body.role, body.type, body.emailAddress);
                }
            }
        }
        else if (path.match(/\/files\/[^\/]+\/modifiedTime$/)) {
            const id = path.split('/')[2];
            result = { modifiedTime: await this.adapter.getLastModified(id) };
        }
        // --- Low-Level Spreadsheets (IStorageLayer) ---
        else if (path === '/spreadsheets') {
            if (method === 'POST') {
                const id = await this.adapter.createSpreadsheet(body.title, body.sheetTitles, body.properties);
                result = { id };
            }
        }
        else if (path.match(/\/spreadsheets\/[^\/]+$/)) {
            const id = path.split('/')[2];
            if (method === 'GET') {
                const fields = url.searchParams.get('fields');
                result = await this.adapter.getSpreadsheet(id, fields || undefined);
            }
        }
        else if (path.match(/\/spreadsheets\/[^\/]+\/values:batchGet$/)) {
            const id = path.split('/')[2];
            const rangesParam = url.searchParams.get('ranges');
            const ranges = rangesParam ? JSON.parse(rangesParam) : [];
            const valueRanges = await this.adapter.batchGetValues(id, ranges);
            result = { valueRanges };
        }
        else if (path.match(/\/spreadsheets\/[^\/]+\/values:batchUpdate$/)) {
            const id = path.split('/')[2];
            await this.adapter.batchUpdateValues(id, body.data);
            result = { success: true };
        }
        else if (path.match(/\/spreadsheets\/[^\/]+\/values\/[^:]+:append$/)) {
            const id = path.split('/')[2];
            const range = decodeURIComponent(path.split('/')[4].replace(':append', ''));
            await this.adapter.appendValues(id, range, body.values);
            result = { success: true };
        }
        else if (path.match(/\/spreadsheets\/[^\/]+\/values\/[^\?]+$/) && method === 'PUT') {
            const id = path.split('/')[2];
            const range = decodeURIComponent(path.split('/')[4]);
            await this.adapter.updateValues(id, range, body.values);
            result = { success: true };
        }
        else if (path.match(/\/spreadsheets\/[^\/]+:batchUpdate$/)) {
            const id = path.split('/')[2];
            await this.adapter.batchUpdateSpreadsheet(id, body.requests);
            result = { success: true };
        }

        if (result !== undefined) {
            return { status: 200, body: result };
        } else if (path === '/reset' && method === 'POST') {
            this.reset();
            return { status: 200, body: { success: true } };
        } else {
            return { status: 404, body: 'Not Found' };
        }
    }

    /**
     * Directly inject an expense into the in-memory adapter for a given
     * spreadsheet (group). Used by T4 concurrency tests to simulate a
     * background write by another user without going through the app UI.
     */
    async injectExpense(spreadsheetId: string, expense: {
        id: string;
        date: string;
        description: string;
        amount: number;
        paidBy: string;
        category: string;
        splits: Array<{ userId: string; amount: number }>;
    }): Promise<void> {
        const splitsJson = JSON.stringify(expense.splits);
        const meta = JSON.stringify({ lastModified: new Date().toISOString() });
        const row = [
            expense.id,
            expense.date,
            expense.description,
            String(expense.amount),
            expense.paidBy,
            expense.category,
            splitsJson,
            meta,
        ];
        await this.adapter.appendValues(spreadsheetId, 'Expenses!A1', [row]);
    }
}

export const mockServer = new MockServer();
