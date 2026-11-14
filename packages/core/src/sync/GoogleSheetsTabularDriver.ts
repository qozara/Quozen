import {
    GoogleSheetsTabularDriver as BaseGoogleSheetsTabularDriver,
    type GoogleDriverOptions,
} from "@qozara/cloud-sync-google";
import { QuozenSchema } from "../schema/SchemaDefinition";
import { ValidationService } from "../schema/ValidationService";

export class GoogleSheetsTabularDriver extends BaseGoogleSheetsTabularDriver {
    constructor(options: GoogleDriverOptions) {
        super({
            ...options,
            defaultSchema: QuozenSchema,
            autoCreateMissingTabOnWrite: false,
            throwTableNotFoundError: true,
            filterEmptyRows: true,
            caseInsensitiveHeaders: true,
            headerAliases: { categories: "categoryId" },
            validationServiceFactory: (getToken) => new ValidationService(getToken),
        });
    }
}
