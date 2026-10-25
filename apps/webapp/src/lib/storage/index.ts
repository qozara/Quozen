import {
    QuozenClient,
    GoogleDriveStorageLayer,
    InMemoryAdapter,
    RemoteMockAdapter,
    GoogleDriveBlobDriver,
    GoogleSheetsTabularDriver,
    CompositeCloudSyncProvider,
    getQuozenDatabase,
    clearQuozenDatabase,
    type QuozenDatabase,
    type BlobStorageDriver,
    type CloudSyncProvider,
    type IStorageLayer
} from "@quozen/core";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { getAuthToken } from "../tokenStore";

class StorageLayerBlobDriver implements BlobStorageDriver {
    id = "storage-layer-blob";
    name = "Storage Layer Blob Driver";
    constructor(private storage: IStorageLayer) {}

    async readBlob<T = unknown>(fileName: string): Promise<T | null> {
        const files = await this.storage.listFiles(`name = '${fileName}' and trashed = false`);
        if (files.length === 0) return null;
        return (await this.storage.getFile(files[0].id, { alt: "media" })) as T;
    }

    async writeBlob<T = unknown>(fileName: string, data: T): Promise<void> {
        const files = await this.storage.listFiles(`name = '${fileName}' and trashed = false`);
        const content = JSON.stringify(data);
        if (files.length > 0) {
            await this.storage.updateFile(files[0].id, {}, content);
        } else {
            await this.storage.createFile(fileName, "application/json", undefined, content);
        }
    }
}

let cachedAdapter: IStorageLayer | null = null;
let cachedDb: QuozenDatabase | undefined = undefined;
let cachedBlobDriver: BlobStorageDriver | undefined = undefined;
let cachedSyncProvider: CloudSyncProvider | undefined = undefined;
let cachedClient: QuozenClient | null = null;
let cachedUserKey = "";
let cachedHasDb = false;
let dbInitPromise: Promise<QuozenDatabase> | null = null;

function ensureDrivers(adapter: IStorageLayer, useMock: boolean) {
    if (!cachedBlobDriver) {
        cachedBlobDriver = useMock
            ? new StorageLayerBlobDriver(adapter)
            : new GoogleDriveBlobDriver({ getAccessToken: getAuthToken });
    }
    if (!cachedSyncProvider) {
        const tabularDriver = new GoogleSheetsTabularDriver({
            getAccessToken: getAuthToken,
            storageLayer: adapter
        });
        cachedSyncProvider = new CompositeCloudSyncProvider({
            id: "google-composite",
            name: "Google Drive & Sheets Composite Provider",
            blobDriver: cachedBlobDriver,
            tabularDriver
        });
    }
    if (cachedSyncProvider && !cachedSyncProvider.isInitialized() && (useMock || Boolean(getAuthToken()))) {
        void cachedSyncProvider.initialize();
    }
}

export const initQuozenStorage = async (): Promise<QuozenDatabase> => {
    if (cachedDb) return cachedDb;
    if (dbInitPromise) return dbInitPromise;

    const isTest = import.meta.env.MODE === "test";
    const storage = isTest ? getRxStorageMemory() : getRxStorageDexie();

    dbInitPromise = getQuozenDatabase({
        name: "quozendb",
        storage
    })
        .catch(async (err: any) => {
            if (err?.code === "DB6") {
                console.warn("[QuozenStorage] RxDB schema hash mismatch (DB6) detected, resetting local cache database:", err);
                return clearQuozenDatabase({
                    name: "quozendb",
                    storage
                });
            }
            dbInitPromise = null;
            throw err;
        })
        .then(db => {
            cachedDb = db;
            cachedClient = null;
            return db;
        });

    return dbInitPromise;
};

export const resetQuozenStorage = async (): Promise<void> => {
    cachedAdapter = null;
    cachedDb = undefined;
    cachedBlobDriver = undefined;
    cachedSyncProvider = undefined;
    cachedClient = null;
    cachedUserKey = "";
    cachedHasDb = false;
    dbInitPromise = null;
    if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem("quozen_active_group_id");
    }
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem("quozen_active_group_id");
    }
};

export const getQuozen = (): QuozenClient => {
    const userStr = localStorage.getItem("quozen_user_profile");
    const user = userStr ? JSON.parse(userStr) : { id: "", username: "", email: "", name: "" };

    const mockValue = import.meta.env.VITE_USE_MOCK_STORAGE;
    const useRemoteMock = mockValue === "remote";
    const useMock = useRemoteMock || mockValue === "true" || import.meta.env.MODE === "test";

    if (!cachedAdapter) {
        cachedAdapter = useMock
            ? (useRemoteMock ? new RemoteMockAdapter(getAuthToken) : new InMemoryAdapter())
            : new GoogleDriveStorageLayer(getAuthToken);
    }

    ensureDrivers(cachedAdapter, useMock);

    // Trigger background RxDB initialization in browser runtime if not already started
    if (!cachedDb && !dbInitPromise && import.meta.env.MODE !== "test") {
        void initQuozenStorage().catch(err => {
            console.warn("[QuozenStorage] Background RxDB init failed, falling back to storage adapter:", err);
        });
    }

    const userKey = `${user.id}:${user.email}`;
    const hasDb = Boolean(cachedDb);

    if (!cachedClient || cachedUserKey !== userKey || cachedHasDb !== hasDb) {
        if (cachedUserKey && cachedUserKey !== userKey && cachedSyncProvider) {
            (cachedSyncProvider as any).setActiveGroupId?.(null);
        }
        cachedUserKey = userKey;
        cachedHasDb = hasDb;
        cachedClient = new QuozenClient({
            storage: cachedAdapter,
            user,
            enableCache: true,
            cacheTtlMs: 30000,
            getToken: getAuthToken,
            db: cachedDb,
            blobDriver: useMock ? undefined : cachedBlobDriver,
            syncProvider: cachedSyncProvider
        });
    }

    return cachedClient;
};

export const quozen = new Proxy({} as QuozenClient, {
    get(_, prop) {
        return (getQuozen() as any)[prop];
    }
});

export { InMemoryAdapter };
