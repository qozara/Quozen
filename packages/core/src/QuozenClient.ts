import { IStorageLayer } from "./infrastructure/IStorageLayer";
import { GroupRepository } from "./infrastructure/GroupRepository";
import { LedgerRepository } from "./infrastructure/LedgerRepository";
import { LedgerService } from "./finance/LedgerService";
import { User } from "./domain/models";
import { StorageCacheProxy } from "./infrastructure/StorageCacheProxy";
import { ValidationService } from "./schema/ValidationService";
import type { QuozenDatabase } from "./db";
import type { CloudSyncProvider, BlobStorageDriver } from "./sync/types";
import { ReplicationCoordinator } from "./sync/ReplicationCoordinator";

export interface QuozenConfig {
    storage: IStorageLayer;
    user: User;
    enableCache?: boolean;
    cacheTtlMs?: number;
    getToken?: () => string | null;
    db?: QuozenDatabase;
    syncProvider?: CloudSyncProvider;
    blobDriver?: BlobStorageDriver;
}

export class QuozenClient {
    public static readonly version: string = "1.0.0";
    public groups: GroupRepository;
    private storage: IStorageLayer;
    public db?: QuozenDatabase;
    public syncProvider?: CloudSyncProvider;
    public replication?: ReplicationCoordinator;

    constructor(private config: QuozenConfig) {
        this.storage = config.enableCache
            ? new StorageCacheProxy(config.storage, config.cacheTtlMs)
            : config.storage;

        this.db = config.db;
        this.syncProvider = config.syncProvider;
        if (this.db && this.syncProvider) {
            this.replication = new ReplicationCoordinator(this.db, this.syncProvider);
        }

        this.groups = new GroupRepository(
            this.storage,
            config.user,
            config.getToken,
            this.db,
            config.blobDriver
        );
    }

    public get user(): User {
        return this.config.user;
    }

    public ledger(groupId: string): LedgerService {
        const repo = new LedgerRepository(this.storage, groupId, this.db);
        const validationSvc = this.config.getToken ? new ValidationService(this.config.getToken) : undefined;
        return new LedgerService(repo, this.config.user, validationSvc, groupId);
    }

    public async getLastModified(fileId: string): Promise<string> {
        return this.storage.getLastModified(fileId);
    }

    public async getFileMetadata(fileId: string): Promise<any> {
        return this.storage.getFile(fileId, { fields: "*" });
    }

    public get internalStorage(): IStorageLayer {
        return this.storage;
    }
}
