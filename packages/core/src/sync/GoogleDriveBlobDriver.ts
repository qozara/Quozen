import type { BlobStorageDriver, GoogleDriverOptions, GoogleHttpClient } from "./types";
import type { IStorageLayer } from "../infrastructure/IStorageLayer";

export class GoogleDriveBlobDriver implements BlobStorageDriver {
    id = "google-drive-appdata-blob";
    name = "Google Drive AppData Blob Driver";

    private getAccessToken: () => string | null;
    private client: GoogleHttpClient;
    private storageLayer?: IStorageLayer;

    constructor(options: GoogleDriverOptions) {
        this.getAccessToken = options.getAccessToken;
        this.storageLayer = options.storageLayer;
        this.client = options.httpClient || {
            fetch: (url, init) => globalThis.fetch(url, init)
        };
    }

    private getAuthHeaders(): Record<string, string> {
        const token = this.getAccessToken();
        if (!token) {
            throw new Error("Google Auth Failed: Access token is missing or expired");
        }
        return {
            Authorization: `Bearer ${token}`
        };
    }

    private async handleResponseErrors(res: Response, context: string): Promise<void> {
        if (!res.ok) {
            let errText = "";
            try {
                errText = await res.text();
            } catch {}

            if (res.status === 401 || res.status === 403) {
                const error: any = new Error(`Google Auth Failed (${res.status}) during ${context}. Details: ${errText}`);
                error.status = res.status;
                throw error;
            }
            if (res.status === 429) {
                throw new Error(`Google Drive API Rate Limit / Quota Exceeded (429) during ${context}`);
            }
            throw new Error(`Google Drive API Error (${res.status}) during ${context}. Details: ${errText}`);
        }
    }

    private async findFileInAppData(filename: string): Promise<string | null> {
        const headers = this.getAuthHeaders();
        const query = encodeURIComponent(`name = '${filename}' and trashed = false`);
        const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name)`;

        const res = await this.client.fetch(url, { method: "GET", headers });
        await this.handleResponseErrors(res, "searching appDataFolder");

        const json = (await res.json()) as any;
        if (json.files && json.files.length > 0) {
            return json.files[0].id;
        }
        return null;
    }

    private async findLegacyFileInRootDrive(filename: string): Promise<string | null> {
        const headers = this.getAuthHeaders();
        const query = encodeURIComponent(`name = '${filename}' and trashed = false`);
        const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,createdTime)`;

        const res = await this.client.fetch(url, { method: "GET", headers });
        if (!res.ok) return null;

        const json = (await res.json()) as any;
        if (json.files && json.files.length > 0) {
            return json.files[0].id;
        }
        return null;
    }

    async readBlob<T = any>(filename: string): Promise<T | null> {
        // Fallback to IStorageLayer in mock/in-memory environments without HTTP tokens
        if (this.storageLayer && !this.getAccessToken()) {
            const files = await this.storageLayer.listFiles(`name = '${filename}' and trashed = false`);
            if (files.length === 0) return null;
            const data = await this.storageLayer.getFile(files[0].id, { alt: "media" });
            return (data as T) || null;
        }

        const headers = this.getAuthHeaders();
        const appDataFileId = await this.findFileInAppData(filename);

        if (appDataFileId) {
            const url = `https://www.googleapis.com/drive/v3/files/${appDataFileId}?alt=media`;
            const res = await this.client.fetch(url, { method: "GET", headers });
            await this.handleResponseErrors(res, "reading blob from appDataFolder");
            return (await res.json()) as T;
        }

        // Legacy Migration Path: check if quozen-settings.json exists in root Drive
        const legacyFileId = await this.findLegacyFileInRootDrive(filename);
        if (legacyFileId) {
            const url = `https://www.googleapis.com/drive/v3/files/${legacyFileId}?alt=media`;
            const res = await this.client.fetch(url, { method: "GET", headers });
            if (res.ok) {
                const legacyData = (await res.json()) as T;
                // Automatically migrate to appDataFolder
                try {
                    await this.writeBlob(filename, legacyData);
                } catch (e) {
                    console.warn("[GoogleDriveBlobDriver] Failed to write migrated blob to appDataFolder:", e);
                }
                return legacyData;
            }
        }

        return null;
    }

    async writeBlob<T = any>(filename: string, data: T): Promise<void> {
        if (this.storageLayer && !this.getAccessToken()) {
            const files = await this.storageLayer.listFiles(`name = '${filename}' and trashed = false`);
            if (files.length > 0) {
                await this.storageLayer.updateFile(files[0].id, {}, JSON.stringify(data));
            } else {
                await this.storageLayer.createFile(filename, "application/json", {}, JSON.stringify(data));
            }
            return;
        }

        const existingFileId = await this.findFileInAppData(filename);
        const headers = this.getAuthHeaders();
        const boundary = "-------quozen_blob_boundary";
        const delimiter = `\r\n--${boundary}\r\n`;
        const closeDelimiter = `\r\n--${boundary}--`;

        const metadata = existingFileId
            ? { name: filename }
            : { name: filename, parents: ["appDataFolder"] };

        const multipartRequestBody =
            delimiter +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify(metadata) +
            delimiter +
            "Content-Type: application/json\r\n\r\n" +
            JSON.stringify(data) +
            closeDelimiter;

        const url = existingFileId
            ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

        const method = existingFileId ? "PATCH" : "POST";

        const res = await this.client.fetch(url, {
            method,
            headers: {
                ...headers,
                "Content-Type": `multipart/related; boundary=${boundary}`
            },
            body: multipartRequestBody
        });

        await this.handleResponseErrors(res, "writing blob to appDataFolder");
    }

    async deleteBlob(filename: string): Promise<void> {
        if (this.storageLayer && !this.getAccessToken()) {
            const files = await this.storageLayer.listFiles(`name = '${filename}' and trashed = false`);
            for (const f of files) {
                await this.storageLayer.deleteFile(f.id);
            }
            return;
        }

        const fileId = await this.findFileInAppData(filename);
        if (!fileId) return;

        const headers = this.getAuthHeaders();
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
        const res = await this.client.fetch(url, { method: "DELETE", headers });
        await this.handleResponseErrors(res, "deleting blob from appDataFolder");
    }
}
