import { IStorageLayer } from "../infrastructure/IStorageLayer";
import { Expense, Settlement, Member } from "../types";

interface MockSheet {
    name: string;
    sheetNames: string[];
    expenses: Expense[];
    settlements: Settlement[];
    members: Member[];
    createdTime: string;
    modifiedTime: string;
    content?: any;
    isPublic?: boolean;
    properties?: Record<string, string>;
    sheetData?: Record<string, any[][]>;
    sheetIds?: Record<string, number>;
}

/**
 * In-memory implementation of IStorageLayer used primarily for Tier 1 (Unit)
 * and Tier 3a (Mocked E2E) testing. It provides a blazing-fast, state-isolated
 * environment that perfectly mimics the behavior of the GoogleDriveStorageLayer
 * without requiring real network calls or OAuth tokens.
 */
export class InMemoryAdapter implements IStorageLayer {
    private sheets: Map<string, MockSheet> = new Map();
    // Refactored to Maps to prevent prototype pollution
    private globalSheetData = new Map<string, Map<string, any[][]>>();
    private globalSheetIds = new Map<string, Map<string, number>>();

    constructor() {
        console.log("[MemoryAdapter] Initialized.");
    }

    // --- File Operations ---

    async createFile(name: string, mimeTypeOrSheetNames: string | string[], properties?: Record<string, string>, content?: string): Promise<string> {
        const id = "mock-sheet-" + (typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).substring(7));
        const sheetNames = Array.isArray(mimeTypeOrSheetNames) ? mimeTypeOrSheetNames : [];
        let parsedContent = content;
        if (typeof content === 'string') {
            try { parsedContent = JSON.parse(content); } catch { parsedContent = content; }
        }
        this.sheets.set(id, {
            name,
            sheetNames,
            expenses: [],
            settlements: [],
            members: [],
            createdTime: new Date().toISOString(),
            modifiedTime: new Date().toISOString(),
            properties: properties || {},
            content: parsedContent
        });
        return id;
    }

    async deleteFile(fileId: string): Promise<void> {
        this.sheets.delete(fileId);
    }

    async renameFile(fileId: string, newName: string): Promise<void> {
        const sheet = this.getAndTouch(fileId);
        if (sheet) sheet.name = newName;
    }

    async setFilePermissions(fileId: string, access: 'public' | 'restricted'): Promise<void> {
        const sheet = this.getAndTouch(fileId);
        if (sheet) {
            sheet.isPublic = (access === 'public');
        }
    }

    async getFilePermissions(fileId: string): Promise<'public' | 'restricted'> {
        const sheet = this.sheets.get(fileId);
        return sheet?.isPublic ? 'public' : 'restricted';
    }

    async addFileProperties(fileId: string, properties: Record<string, string>): Promise<void> {
        const sheet = this.getAndTouch(fileId);
        if (sheet) {
            sheet.properties = { ...sheet.properties, ...properties };
        }
    }

    async listFiles(queryOrOptions: string | { nameContains?: string; properties?: Record<string, string> } = {}, _fields?: string): Promise<Array<{ id: string, name: string, createdTime: string, owners: any[], capabilities: any, properties?: Record<string, string> }>> {
        const files: any[] = [];

        for (const [id, sheet] of this.sheets.entries()) {
            let match = true;

            if (typeof queryOrOptions === 'string') {
                if (queryOrOptions.includes("name = 'quozen-settings.json'") && sheet.name !== "quozen-settings.json") match = false;
                if (queryOrOptions.includes("properties has { key='quozen_type' and value='group' }") && sheet.properties?.['quozen_type'] !== 'group') match = false;
            } else {
                const options = queryOrOptions;
                if (options.properties) {
                    for (const [key, value] of Object.entries(options.properties)) {
                        if (sheet.properties?.[key] !== value) {
                            match = false;
                            break;
                        }
                    }
                } else if (options.nameContains) {
                    if (!sheet.name.includes(options.nameContains)) {
                        match = false;
                    }
                }
            }

            if (match) {
                files.push({
                    id,
                    name: sheet.name,
                    createdTime: sheet.createdTime,
                    owners: [],
                    capabilities: { canDelete: true },
                    properties: sheet.properties
                });
            }
        }
        return files;
    }

    async getLastModified(fileId: string): Promise<string> {
        const sheet = this.sheets.get(fileId);
        return sheet?.modifiedTime || new Date().toISOString();
    }

    // --- IStorageLayer Additions (SDK Backend Mock) ---

    async getFile(fileId: string, options?: { alt?: string; fields?: string }): Promise<any> {
        const sheet = this.sheets.get(fileId);
        if (!sheet) throw new Error("File not found");
        if (options?.alt === 'media') {
            return typeof sheet.content === 'string' ? JSON.parse(sheet.content) : (sheet.content || {});
        }
        return {
            id: fileId,
            name: sheet.name,
            properties: sheet.properties,
            modifiedTime: sheet.modifiedTime
        };
    }

    async updateFile(fileId: string, metadata?: any, content?: string): Promise<any> {
        const sheet = this.getAndTouch(fileId);
        if (!sheet) throw new Error("File not found");
        if (metadata?.name) sheet.name = metadata.name;
        if (metadata?.properties) sheet.properties = { ...sheet.properties, ...metadata.properties };
        if (content) sheet.content = typeof content === 'string' ? JSON.parse(content) : content;
        return { id: fileId, name: sheet.name };
    }

    async createPermission(_fileId: string, role: string, type: string, emailAddress?: string): Promise<any> {
        return { id: "perm-" + Math.random(), role, type, emailAddress, displayName: emailAddress ? emailAddress.split('@')[0] : "User" };
    }

    async listPermissions(_fileId: string): Promise<any[]> {
        return [];
    }

    async deletePermission(_fileId: string, _permissionId: string): Promise<void> { }

    async createSpreadsheet(title: string, sheetTitles: string[], properties?: Record<string, string>): Promise<string> {
        const id = await this.createFile(title, sheetTitles, properties);
        const sData = new Map<string, any[][]>();
        const sIds = new Map<string, number>();

        sheetTitles.forEach((t, i) => {
            sData.set(t, []);
            sIds.set(t, i + 1);
        });

        this.globalSheetData.set(id, sData);
        this.globalSheetIds.set(id, sIds);
        return id;
    }

    async getSpreadsheet(spreadsheetId: string, _fields?: string): Promise<any> {
        const sheet = this.sheets.get(spreadsheetId);
        if (!sheet) throw new Error("File not found");

        const sIds = this.globalSheetIds.get(spreadsheetId) || new Map<string, number>();
        const sheetNames = sheet.sheetNames?.length ? sheet.sheetNames : Array.from(sIds.keys());

        return {
            spreadsheetId,
            properties: { title: sheet.name },
            sheets: sheetNames.map(title => ({
                properties: { title, sheetId: sIds.get(title) || 0 }
            }))
        };
    }

    async batchGetValues(spreadsheetId: string, ranges: string[]): Promise<any[]> {
        const sData = this.globalSheetData.get(spreadsheetId);
        if (!sData) return [];

        return ranges.map(range => {
            const [sheetName, cellRange] = range.split('!');
            const rows = sData.get(sheetName) || [];
            let startIndex = 0;
            if (cellRange) {
                const match = cellRange.match(/\d+/);
                if (match) startIndex = parseInt(match[0]) - 1;
            }
            return { values: rows.slice(startIndex).filter(r => r !== undefined) };
        });
    }

    async batchUpdateValues(spreadsheetId: string, data: { range: string; values: any[][] }[]): Promise<void> {
        const sData = this.globalSheetData.get(spreadsheetId);
        if (!sData) return;

        data.forEach(d => {
            const [sheetName, cellRange] = d.range.split('!');
            if (!sData.has(sheetName)) sData.set(sheetName, []);

            const targetSheet = sData.get(sheetName)!;
            let startIndex = 0;
            if (cellRange) {
                const match = cellRange.match(/\d+/);
                if (match) startIndex = parseInt(match[0]) - 1;
            }

            d.values.forEach((row, i) => {
                targetSheet[startIndex + i] = row;
            });
        });
        this.getAndTouch(spreadsheetId);
    }

    async appendValues(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
        const sheetName = range.split('!')[0];
        const sData = this.globalSheetData.get(spreadsheetId);
        if (!sData) return;

        if (!sData.has(sheetName)) sData.set(sheetName, []);
        sData.get(sheetName)!.push(...values);

        this.getAndTouch(spreadsheetId);
    }

    async updateValues(spreadsheetId: string, range: string, values: any[][]): Promise<void> {
        const sheetName = range.split('!')[0];
        const cellRange = range.split('!')[1];
        let startIndex = 0;

        if (cellRange) {
            const match = cellRange.match(/\d+/);
            if (match) startIndex = parseInt(match[0]) - 1;
        }

        const sData = this.globalSheetData.get(spreadsheetId);
        if (!sData) return;

        if (!sData.has(sheetName)) sData.set(sheetName, []);
        const targetSheet = sData.get(sheetName)!;

        values.forEach((row, i) => {
            targetSheet[startIndex + i] = row;
        });

        this.getAndTouch(spreadsheetId);
    }

    async batchUpdateSpreadsheet(spreadsheetId: string, requests: any[]): Promise<void> {
        const sData = this.globalSheetData.get(spreadsheetId);
        const sIds = this.globalSheetIds.get(spreadsheetId);
        if (!sData || !sIds) return;

        requests.forEach(req => {
            if (req.deleteDimension) {
                const sheetId = req.deleteDimension.range.sheetId;
                const startIndex = req.deleteDimension.range.startIndex;
                const endIndex = req.deleteDimension.range.endIndex;

                let targetSheetName: string | undefined;
                for (const [name, id] of sIds.entries()) {
                    if (id === sheetId) {
                        targetSheetName = name;
                        break;
                    }
                }

                if (targetSheetName && sData.has(targetSheetName)) {
                    sData.get(targetSheetName)!.splice(startIndex, endIndex - startIndex);
                }
            }
        });
        this.getAndTouch(spreadsheetId);
    }

    private getAndTouch(fileId: string): MockSheet | undefined {
        const sheet = this.sheets.get(fileId);
        if (sheet) {
            sheet.modifiedTime = new Date().toISOString();
        }
        return sheet;
    }
}
