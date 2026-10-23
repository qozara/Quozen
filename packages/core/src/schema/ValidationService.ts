import {
    SchemaEngine,
    GoogleSheetsFetchClient,
    ValidationStatus,
    type SchemaStatusDTO as GDocsSchemaStatusDTO,
} from "@qozara/gdocs-schema";
import { QuozenSchema } from "./SchemaDefinition";
import { migrations } from "./migrations/index";
import { ConflictError, SchemaIncompatibleError } from "../errors";

export { ValidationStatus };

export interface SchemaStatusDTO extends Omit<GDocsSchemaStatusDTO, "lastModifiedTime"> {
    lastModifiedTime: string;
}

export class ValidationService {
    public readonly client: GoogleSheetsFetchClient;
    public readonly engine: SchemaEngine;

    constructor(getToken: () => string | null) {
        const token = getToken();
        if (!token) throw new Error("ValidationService requires a valid Google access token.");

        this.client = new GoogleSheetsFetchClient({
            accessToken: token,
            fetchImpl: async (url: string | Request | URL, init?: RequestInit) => {
                const finalInit = init ? { ...init } : {};
                if (finalInit.method === "GET" && finalInit.headers) {
                    const headers = new Headers(finalInit.headers as any);
                    headers.delete("Content-Type");
                    finalInit.headers = headers;
                }
                return globalThis.fetch(url, finalInit);
            },
        });
        this.engine = new SchemaEngine(this.client);
    }

    public async createBackup(spreadsheetId: string, customName?: string): Promise<string> {
        return this.client.createBackup(spreadsheetId, customName);
    }

    public async checkHealth(spreadsheetId: string): Promise<SchemaStatusDTO> {
        const result = await this.engine.checkHealth(spreadsheetId, QuozenSchema);
        return {
            ...result,
            lastModifiedTime: result.lastModifiedTime || new Date().toISOString(),
        };
    }

    public async initializeFile(spreadsheetId: string, version: number = QuozenSchema.version): Promise<void> {
        await this.engine.initializeFile(spreadsheetId, version);
        await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
    }

    public async repairFile(spreadsheetId: string, expectedLastModified?: string): Promise<void> {
        if (expectedLastModified) {
            const res = (await this.client.getFileAppProperties(spreadsheetId)) as any;
            const currentModified = res?.modifiedTime ? new Date(res.modifiedTime).getTime() : 0;
            const expectedModified = new Date(expectedLastModified).getTime();
            if (currentModified > 0 && expectedModified > 0 && currentModified > expectedModified) {
                throw new ConflictError("Spreadsheet has been modified since it was last fetched.");
            }
        }

        try {
            await this.engine.repair(spreadsheetId, QuozenSchema, undefined, migrations);
            await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
        } catch (e: any) {
            if (e?.message?.toLowerCase().includes("incompatible")) {
                throw new SchemaIncompatibleError("Cannot repair spreadsheet: the schema is from a newer version of Quozen.");
            }
            throw e;
        }
    }

    public async migrateFile(spreadsheetId: string, expectedLastModified?: string): Promise<void> {
        if (expectedLastModified) {
            const res = (await this.client.getFileAppProperties(spreadsheetId)) as any;
            const currentModified = res?.modifiedTime ? new Date(res.modifiedTime).getTime() : 0;
            const expectedModified = new Date(expectedLastModified).getTime();
            if (currentModified > 0 && expectedModified > 0 && currentModified > expectedModified) {
                throw new ConflictError("Spreadsheet has been modified since it was last fetched.");
            }
        }

        try {
            await this.engine.migrate(spreadsheetId, QuozenSchema, migrations);
            await this.updateFileMetadata(spreadsheetId, ValidationStatus.READY);
        } catch (e: any) {
            if (e?.message?.toLowerCase().includes("incompatible")) {
                throw new SchemaIncompatibleError("Cannot migrate spreadsheet: the schema is from a newer version of Quozen.");
            }
            throw e;
        }
    }

    public async updateFileMetadata(spreadsheetId: string, status: ValidationStatus): Promise<void> {
        const properties = {
            quozen_validation_status: status,
            quozen_validation_time: new Date().toISOString(),
            quozen_type: "group",
            version: "1.0",
        };
        await this.client.updateFileAppProperties(spreadsheetId, properties).catch(() => {});
    }
}
