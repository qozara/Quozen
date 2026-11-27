import {
    ValidationService as BaseValidationService,
    ValidationStatus,
    type SchemaStatusDTO as BaseSchemaStatusDTO,
    type SchemaDefinition,
} from "@qozara/cloud-sync-google";
import {
    ConflictError,
    ForeignDocumentError,
    SchemaIncompatibleError,
    UnmanagedDocumentError,
} from "../errors";
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

    public override async healForkedCopy(
        spreadsheetId: string,
        schema: SchemaDefinition = QuozenSchema,
        extraMeta?: Record<string, string>
    ): Promise<BaseSchemaStatusDTO> {
        return super.healForkedCopy(spreadsheetId, schema, extraMeta);
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
            if (e instanceof UnmanagedDocumentError || e?.name === "UnmanagedDocumentError") {
                throw new UnmanagedDocumentError(spreadsheetId, e?.message);
            }
            if (e instanceof ForeignDocumentError || e?.name === "ForeignDocumentError") {
                throw new ForeignDocumentError(e?.message, e?.detectedAppId, e?.detectedDocType);
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
            if (e instanceof UnmanagedDocumentError || e?.name === "UnmanagedDocumentError") {
                throw new UnmanagedDocumentError(spreadsheetId, e?.message);
            }
            if (e instanceof ForeignDocumentError || e?.name === "ForeignDocumentError") {
                throw new ForeignDocumentError(e?.message, e?.detectedAppId, e?.detectedDocType);
            }
            throw e;
        }
    }

    public async updateFileMetadata(spreadsheetId: string, status: ValidationStatus): Promise<void> {
        await super.updateFileMetadata(spreadsheetId, status, QuozenSchema.version);
    }
}
