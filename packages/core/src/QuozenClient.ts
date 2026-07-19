import { IStorageLayer } from "./infrastructure/IStorageLayer";
import { GroupRepository } from "./infrastructure/GroupRepository";
import { LedgerRepository } from "./infrastructure/LedgerRepository";
import { LedgerService } from "./finance/LedgerService";
import { User } from "./domain/models";
import { StorageCacheProxy } from "./infrastructure/StorageCacheProxy";
import { ValidationService } from "./schema/ValidationService";

export interface QuozenConfig {
    storage: IStorageLayer;
    user: User;
    enableCache?: boolean;
    cacheTtlMs?: number;
    getToken?: () => string | null;
}

export class QuozenClient {
    public static readonly version: string = "1.0.0";
    public groups: GroupRepository;
    private storage: IStorageLayer;

    constructor(private config: QuozenConfig) {
        this.storage = config.enableCache
            ? new StorageCacheProxy(config.storage, config.cacheTtlMs)
            : config.storage;

        this.groups = new GroupRepository(this.storage, config.user, config.getToken);
    }

    public get user(): User {
        return this.config.user;
    }

    public ledger(groupId: string): LedgerService {
        const repo = new LedgerRepository(this.storage, groupId);
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
