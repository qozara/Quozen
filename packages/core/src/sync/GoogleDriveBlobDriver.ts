import {
    GoogleDriveBlobDriver as BaseGoogleDriveBlobDriver,
    type GoogleDriverOptions,
} from "@qozara/cloud-sync-google";

export class GoogleDriveBlobDriver extends BaseGoogleDriveBlobDriver {
    constructor(options: GoogleDriverOptions) {
        super({
            ...options,
            enableLegacyRootMigration: true,
            multipartBoundary: "-------quozen_blob_boundary",
        });
    }
}
