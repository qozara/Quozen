import { Route, Request } from '@playwright/test';
import { InMemoryAdapter } from '@quozen/core';

// Polyfill self.crypto for Node environment if needed
if (typeof self === 'undefined') {
    (global as any).self = global;
}
if (!global.crypto) {
    (global as any).crypto = require('crypto');
}

class MockServer {
    public adapter: InMemoryAdapter;
    private _latencyMs: number = 0;
    private _nextErrorStatus: number | null = null;

    constructor() {
        this.adapter = new InMemoryAdapter();
    }

    reset() {
        this.adapter = new InMemoryAdapter();
        this._latencyMs = 0;
        this._nextErrorStatus = null;
    }

    /** Add artificial delay to every response (ms). Pass 0 to disable. */
    simulateLatency(ms: number) {
        this._latencyMs = ms;
    }

    /**
     * Force the next storage request to fail with the given HTTP status,
     * then automatically clear. Use for testing error-handling UI flows.
     */
    forceNextError(statusCode: number) {
        this._nextErrorStatus = statusCode;
    }

    /**
     * Directly inject an expense row into the InMemoryAdapter for a given
     * spreadsheetId (groupId), simulating a background write by another user.
     * 
     * Row format matches SheetDataMapper.mapFromExpense:
     * [id, date, description, amount, paidByUserId, category, splitsJSON, metaJSON]
     */
    async injectExpense(spreadsheetId: string, expense: {
        id: string;
        date: string;
        description: string;
        amount: number;
        paidByUserId: string;
        category: string;
        splits: { userId: string; amount: number }[];
    }): Promise<void> {
        const now = new Date().toISOString();
        const row = [
            expense.id,
            expense.date,
            expense.description,
            expense.amount,
            expense.paidByUserId,
            expense.category,
            JSON.stringify(expense.splits),
            JSON.stringify({ createdAt: now, lastModified: now }),
        ];
        await this.adapter.appendValues(spreadsheetId, 'Expenses!A1', [row]);
    }

    /**
 * Overwrites the lastModified timestamp of an existing expense row to a future
 * time, so LedgerService's OCC check throws ConflictError when the edit form saves.
 */
    async updateExpenseTimestamp(spreadsheetId: string, expenseId: string): Promise<void> {
        const rows = await this.adapter.batchGetValues(spreadsheetId, ['Expenses!A2:Z']);
        const allRows: any[][] = rows[0]?.values || [];
        const rowIndex = allRows.findIndex((r: any[]) => r[0] === expenseId);
        if (rowIndex === -1) return;

        const row = [...allRows[rowIndex]];
        const future = new Date(Date.now() + 60_000).toISOString();
        let meta: any = {};
        try { meta = JSON.parse(row[7]); } catch { }
        meta.lastModified = future;
        row[7] = JSON.stringify(meta);

        // +2 because rows are 1-indexed and row 1 is the header
        const sheetRow = rowIndex + 2;
        await this.adapter.updateValues(spreadsheetId, `Expenses!A${sheetRow}`, [row]);
    }

    /** Returns the ID of the most recently created group file in the adapter. */
    async getLatestGroupId(): Promise<string | null> {
        const files = await this.adapter.listFiles(
            "properties has { key='quozen_type' and value='group' }"
        );
        if (!files.length) return null;
        // Most recently created is last in insertion order
        return files[files.length - 1].id;
    }

    async handle(route: Route) {
        const request = route.request();
        if (process.env.DEBUG_MOCK === 'true') {
            console.log(`[MockServer] Request: ${request.method()} ${request.url()}`);
        }
        if (this._latencyMs > 0) {
            await new Promise(r => setTimeout(r, this._latencyMs));
        }

        if (this._nextErrorStatus !== null) {
            const status = this._nextErrorStatus;
            this._nextErrorStatus = null;
            const bodies: Record<number, object> = {
                409: { error: 'Conflict', message: 'The resource was modified by another user.' },
                403: { error: 'Forbidden', message: 'Access denied.' },
                429: { error: 'Too Many Requests', message: 'Rate limit exceeded.' },
                500: { error: 'Internal Server Error', message: 'An unexpected error occurred.' },
            };
            await route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(bodies[status] ?? { error: 'Error' }),
            });
            return;
        }

        const body = request.postDataJSON();

        try {
            const response = await this.dispatch(request.method(), request.url(), body);
            if (process.env.DEBUG_MOCK === 'true') {
                console.log(`[MockServer] Response: ${response.status} for ${request.url()}`);
            }
            await route.fulfill({
                status: response.status,
                contentType: 'application/json',
                body: JSON.stringify(response.body)
            });
        } catch (e: any) {
            console.error("[MockServer] Route Error:", e);
            await route.fulfill({ status: 500, body: e.message });
        }
    }

    async dispatch(method: string, urlStr: string, body: any): Promise<{ status: number, body: any }> {
        const url = new URL(urlStr, 'http://localhost');
        const path = url.pathname.replace('/_test/storage', '');

        // --- AI Proxy ---
        if (path === '/_test/ai-proxy') {
            return { status: 200, body: { status: 'ok' } };
        }
        if (path === '/_test/ai-proxy/api/v1/agent/chat') {
            const prompt = body.messages?.[body.messages.length - 1]?.content || "";
            if (prompt.toLowerCase().includes("uber")) {
                return {
                    status: 200,
                    body: {
                        type: "tool_call",
                        tool: "add_expense",
                        args: {
                            description: "Uber rides",
                            amount: 50,
                            category: "Transport",
                            splits: [
                                { userId: "test-user-id", amount: 25 },
                                { userId: "bob", amount: 25 }
                            ]
                        }
                    }
                };
            }
            return {
                status: 200,
                body: { type: "text", content: "I understood your message, but I don't know how to help with that yet." }
            };
        }

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
            let ranges: string[] = [];
            if (rangesParam?.startsWith('[')) {
                try { ranges = JSON.parse(rangesParam); } catch { }
            } else {
                ranges = url.searchParams.getAll('ranges');
            }
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
}

export const mockServer = new MockServer();
