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
        this.storage = config.enableCache && !config.db
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
            config.blobDriver,
            (groupId?: string) => this.triggerBackgroundSync(groupId)
        );
    }

    private async triggerBackgroundSync(groupId?: string): Promise<void> {
        if (!this.syncProvider || !this.replication) return;
        if (!this.syncProvider.isInitialized() && this.config.getToken?.()) {
            try {
                await this.syncProvider.initialize();
            } catch {
                return;
            }
        }
        if (this.syncProvider.isInitialized()) {
            if (groupId && typeof (this.syncProvider as any).setActiveGroupId === "function") {
                (this.syncProvider as any).setActiveGroupId(groupId);
            }
            void this.replication.sync(groupId).catch(() => {});
        }
    }

    public get user(): User {
        return this.config.user;
    }

    public ledger(groupId: string, activeAccountId?: string): LedgerService {
        const repo = new LedgerRepository(
            this.storage,
            groupId,
            this.db,
            () => this.triggerBackgroundSync(groupId)
        );
        let validationSvc: ValidationService | undefined = undefined;
        if (this.config.getToken && this.config.getToken()) {
            try {
                validationSvc = new ValidationService(this.config.getToken);
            } catch {
                validationSvc = undefined;
            }
        }
        return new LedgerService(
            repo,
            this.config.user,
            validationSvc,
            groupId,
            activeAccountId,
            () => this.groups.getGroupAccountId(groupId)
        );
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
