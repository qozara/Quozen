import type { IStorageLayer } from "../infrastructure/IStorageLayer";

export type SyncStatus =
    | "idle"
    | "syncing"
    | "throttled"
    | "auth_failed"
    | "disconnected"
    | "synced"
    | "corrupted"
    | "upgrade_required"
    | "incompatible"
    | "error";

export type UXSyncState =
    | "synced"
    | "syncing"
    | "warning"
    | "offline"
    | "hidden";

export interface SyncDeltaPayload {
    collection: string;
    groupId?: string;
    documents: Record<string, any>[];
    checkpoint?: string;
}

export interface BlobStorageDriver {
    id: string;
    name: string;
    readBlob<T = any>(filename: string): Promise<T | null>;
    writeBlob<T = any>(filename: string, data: T): Promise<void>;
    deleteBlob?(filename: string): Promise<void>;
}

export interface TabularRow {
    id: string;
    values: any[];
    headers?: string[];
    updatedAt?: string;
    deletedAt?: string | null;
}

export interface TabularStorageDriver {
    id: string;
    name: string;
    readTable(documentId: string, tabName: string): Promise<TabularRow[]>;
    writeTable(documentId: string, tabName: string, headers: string[], rows: TabularRow[]): Promise<void>;
    repairTable?(documentId: string, expectedLastModified?: string): Promise<void>;
    migrateTable?(documentId: string, expectedLastModified?: string): Promise<void>;
    checkHealth?(documentId: string): Promise<any>;
}

export type CollectionRoute =
    | {
          target: "blob";
          filename: string;
      }
    | {
          target: "tabular";
          tabName: string;
      };

export interface CompositeCloudSyncProviderOptions {
    id: string;
    name: string;
    description?: string;
    blobDriver?: BlobStorageDriver;
    tabularDriver?: TabularStorageDriver;
    routes?: Record<string, CollectionRoute>;
    activeGroupId?: string | null;
}

export interface CloudSyncProvider {
    id: string;
    name: string;
    description?: string;
    isInitialized(): boolean;
    getStatus(): SyncStatus;
    getLastSyncedTime(): string | null;
    initialize(credentials?: any): Promise<void>;
    disconnect(): Promise<void>;
    pull(groupId?: string): Promise<SyncDeltaPayload[]>;
    push(payload: SyncDeltaPayload): Promise<void>;
    repair?(groupId: string): Promise<void>;
    migrate?(groupId: string): Promise<void>;
    onStatusChange(listener: (status: SyncStatus) => void): () => void;
}

export interface GoogleHttpClient {
    fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface GoogleDriverOptions {
    getAccessToken: () => string | null;
    httpClient?: GoogleHttpClient;
    storageLayer?: IStorageLayer;
}
