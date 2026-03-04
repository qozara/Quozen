import { IStorageLayer } from "./infrastructure/IStorageLayer";
import { GroupRepository } from "./infrastructure/GroupRepository";
import { LedgerRepository } from "./infrastructure/LedgerRepository";
import { LedgerService } from "./finance/LedgerService";
import { User } from "./domain/models";
import { StorageCacheProxy } from "./infrastructure/StorageCacheProxy";

export interface QuozenConfig {
    storage: IStorageLayer;
    user: User;
    enableCache?: boolean;
    cacheTtlMs?: number;
}

export class QuozenClient {
    public groups: GroupRepository;
    private storage: IStorageLayer;

    constructor(private config: QuozenConfig) {
        this.storage = config.enableCache
            ? new StorageCacheProxy(config.storage, config.cacheTtlMs)
            : config.storage;

        this.groups = new GroupRepository(this.storage, config.user);
    }

    public get user(): User {
        return this.config.user;
    }

    public ledger(groupId: string): LedgerService {
        const repo = new LedgerRepository(this.storage, groupId);
        return new LedgerService(repo, this.config.user);
    }

    public async getLastModified(fileId: string): Promise<string> {
        return this.storage.getLastModified(fileId);
    }
}
