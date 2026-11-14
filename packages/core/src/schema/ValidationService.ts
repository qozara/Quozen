import {
    ValidationService as BaseValidationService,
    ValidationStatus,
    type SchemaStatusDTO as BaseSchemaStatusDTO,
} from "@qozara/gdocs-schema";
import { ConflictError, SchemaIncompatibleError } from "../errors";
import { QuozenSchema } from "./SchemaDefinition";
import { migrations } from "./migrations/index";

export { ValidationStatus };

export interface SchemaStatusDTO extends Omit<BaseSchemaStatusDTO, "lastModifiedTime" | "valid" | "errors"> {
    lastModifiedTime: string;
}

export class ValidationService extends BaseValidationService {
    constructor(getToken: () => string | null) {
        super(getToken, {
            requireTokenOnConstruct: true,
            useSchemaEngine: true,
            defaultSchema: QuozenSchema,
            migrations,
            appPropertyPrefix: "quozen",
            defaultFileType: "group",
        });
    }

    public override async checkHealth(spreadsheetId: string): Promise<SchemaStatusDTO & { valid: boolean; errors: string[]; lastModifiedTime: string }> {
        return super.checkHealth(spreadsheetId, QuozenSchema);
    }

    public override async initializeFile(spreadsheetId: string, version: number = QuozenSchema.version): Promise<void> {
        await super.initializeFile(spreadsheetId, version);
    }

    public async repairFile(spreadsheetId: string, expectedLastModified?: string): Promise<any> {
        try {
            await super.repairFile(spreadsheetId, QuozenSchema, expectedLastModified);
        } catch (e: any) {
            if (e instanceof ConflictError || e?.name === "ConflictError") {
                throw new ConflictError(e?.message || "Data has been modified by another user.");
            }
            if (e instanceof SchemaIncompatibleError || e?.name === "SchemaIncompatibleError") {
                throw new SchemaIncompatibleError("Cannot repair spreadsheet: the schema is from a newer version of Quozen.");
            }
            throw e;
        }
    }

    public async migrateFile(spreadsheetId: string, expectedLastModified?: string): Promise<any> {
        try {
            await super.migrateFile(spreadsheetId, QuozenSchema, migrations, expectedLastModified);
        } catch (e: any) {
            if (e instanceof ConflictError || e?.name === "ConflictError") {
                throw new ConflictError(e?.message || "Data has been modified by another user.");
            }
            if (e instanceof SchemaIncompatibleError || e?.name === "SchemaIncompatibleError") {
                throw new SchemaIncompatibleError("Cannot migrate spreadsheet: the schema is from a newer version of Quozen.");
            }
            throw e;
        }
    }

    public async updateFileMetadata(spreadsheetId: string, status: ValidationStatus): Promise<void> {
        await super.updateFileMetadata(spreadsheetId, status, QuozenSchema.version);
    }
}
