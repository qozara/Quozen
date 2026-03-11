import { ConflictError, NotFoundError } from "../errors";
import { IStorageLayer } from "../infrastructure/IStorageLayer";

const MOCK_API_BASE = "/_test/storage";

export class RemoteMockAdapter implements IStorageLayer {
    constructor(private getToken?: () => string | null) {
        console.log("[RemoteMockAdapter] Initialized. Requests will be forwarded to " + MOCK_API_BASE);
    }

    private async fetch(path: string, options: RequestInit = {}) {
        const token = (this.getToken ? this.getToken() : null) || "mock-token";
        const headers = {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            ...options.headers,
        };
        const res = await (typeof fetch !== 'undefined' ? fetch(`${MOCK_API_BASE}${path}`, { ...options, headers }) : Promise.reject(new Error("fetch is not defined")));
        if (!res.ok) {
            const body = await res.text();
            if (res.status === 409) throw new ConflictError();
            if (res.status === 404) throw new NotFoundError();
            throw new Error(`Mock API Error ${res.status}: ${body}`);
        }
        return res;
    }

    // --- File Operations ---

    async createFile(name: string, mimeType: string, properties?: Record<string, string>, content?: string): Promise<string> {
        const res = await this.fetch(`/files`, {
            method: "POST",
            body: JSON.stringify({ name, mimeType, properties, content })
        });
        const data = await res.json() as any;
        return data.id;
    }

    async deleteFile(fileId: string): Promise<void> {
        await this.fetch(`/files/${fileId}`, { method: "DELETE" });
    }

    async setFilePermissions(fileId: string, access: 'public' | 'restricted'): Promise<void> {
        await this.fetch(`/files/${fileId}/permissions`, {
            method: "POST",
            body: JSON.stringify({ access })
        });
    }

    async getFilePermissions(fileId: string): Promise<'public' | 'restricted'> {
        const res = await this.fetch(`/files/${fileId}/permissions`, { method: "GET" });
        const data = await res.json() as any;
        return data.access;
    }

    async listFiles(query: string, fields?: string): Promise<Array<{ id: string, name: string, createdTime: string, owners: any[], capabilities: any, properties?: Record<string, string> }>> {
        const res = await this.fetch(`/files?q=${encodeURIComponent(query)}`);
        const data = await res.json() as any;
        return data.files || [];
    }

    async getLastModified(fileId: string): Promise<string> {
        const res = await this.fetch(`/files/${fileId}/modifiedTime`);
        const data = await res.json() as any;
        return data.modifiedTime;
    }

    // --- IStorageLayer Additional Methods ---

    async getFile(fileId: string, options?: { alt?: string; fields?: string }): Promise<any> {
        const opts = encodeURIComponent(JSON.stringify(options || {}));
        const res = await this.fetch(`/files/${fileId}?options=${opts}`, { method: "GET" });
        return await res.json();
    }

    async updateFile(fileId: string, metadata?: any, content?: string): Promise<any> {
        const res = await this.fetch(`/files/${fileId}`, {
            method: "PATCH",
            body: JSON.stringify({ metadata, content })
        });
        return await res.json();
    }

    async createPermission(fileId: string, role: string, type: string, emailAddress?: string): Promise<any> {
        const res = await this.fetch(`/files/${fileId}/permissions`, {
            method: "POST",
            body: JSON.stringify({ role, type, emailAddress })
        });
        return await res.json();
    }

    async listPermissions(fileId: string): Promise<any[]> {
        const res = await this.fetch(`/files/${fileId}/permissions`, { method: "GET" });
        const data = await res.json() as any;
        return data.permissions || [];
    }

    async deletePermission(fileId: string, permissionId: string): Promise<void> {
        await this.fetch(`/files/${fileId}/permissions/${permissionId}`, { method: "DELETE" });
    }

    async createSpreadsheet(title: string, sheetTitles: string[], properties?: Record<string, string>): Promise<string> {
        const res = await this.fetch(`/spreadsheets`, {
            method: "POST",
            body: JSON.stringify({ title, sheetTitles, properties })
        });
        const data = await res.json() as any;
        return data.id;
    }

    async getSpreadsheet(spreadsheetId: string, fields?: string): Promise<any> {
        const f = encodeURIComponent(fields || '');
        const res = await this.fetch(`/spreadsheets/${spreadsheetId}?fields=${f}`, { method: "GET" });
        return await res.json();
    }

    async batchGetValues(spreadsheetId: string, ranges: string[]): Promise<any[]> {
        const r = encodeURIComponent(JSON.stringify(ranges));
        const res = await this.fetch(`/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${r}`, { method: "GET" });
        const data = await res.json() as any;
        return data.valueRanges || [];
    }

    async batchUpdateValues(spreadsheetId: string, data: { range: string; values: any[][] }[]): Promise<void> {
        await this.fetch(`/spreadsheets/${spreadsheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ data }) });
    }

    async appendValues(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
        await this.fetch(`/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`, { method: "POST", body: JSON.stringify({ values }) });
    }

    async updateValues(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
        await this.fetch(`/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, { method: "PUT", body: JSON.stringify({ values }) });
    }

    async batchUpdateSpreadsheet(spreadsheetId: string, requests: any[]): Promise<void> {
        await this.fetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
    }
}
