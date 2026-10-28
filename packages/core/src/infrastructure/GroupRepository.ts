import { IStorageLayer } from "./IStorageLayer";
import { Group, User, Member } from "../domain/models";
import { UserSettings, CachedGroup, QUOZEN_PREFIX, SETTINGS_FILE_NAME, REQUIRED_SHEETS, GROUP_SHEETS, MemberInput, SCHEMAS } from "../types";
import { DEFAULT_CATEGORIES } from "../domain/categories";
import { SheetDataMapper } from "./SheetDataMapper";
import { LedgerRepository } from "./LedgerRepository";
import { ValidationService, ValidationStatus } from "../schema/ValidationService";
import { QuozenSchema } from "../schema/SchemaDefinition";
import type { QuozenDatabase } from "../db";
import { userSettingsToDoc, docToUserSettings, memberToDoc, categoryToDoc } from "../db/schemas";
import type { BlobStorageDriver } from "../sync/types";
import { isNetworkError } from "../sync/CompositeCloudSyncProvider";
import { ReplicationCoordinator } from "../sync/ReplicationCoordinator";
import { OfflineOperationError, GroupFileUnavailableError } from "../errors";

export class GroupRepository {
    private accountIdCache = new Map<string, string | undefined>();

    constructor(
        private storage: IStorageLayer,
        private user: User,
        private getToken?: () => string | null,
        private db?: QuozenDatabase,
        private blobDriver?: BlobStorageDriver,
        private onMutation?: (groupId?: string) => void
    ) { }

    private migrateSettingsToV2(settings: UserSettings): UserSettings {
        if (!settings.version || settings.version < 2) {
            settings.version = 2;
        }
        if (!Array.isArray(settings.archivedGroupCache)) {
            settings.archivedGroupCache = [];
        }
        return settings;
    }

    private syncAccountIdCache(settings: UserSettings): UserSettings {
        this.migrateSettingsToV2(settings);
        for (const cached of settings.groupCache || []) {
            if (cached.accountId) {
                this.accountIdCache.set(cached.id, cached.accountId);
            } else if (this.accountIdCache.has(cached.id)) {
                cached.accountId = this.accountIdCache.get(cached.id);
            }
        }
        for (const cached of settings.archivedGroupCache || []) {
            if (cached.accountId) {
                this.accountIdCache.set(cached.id, cached.accountId);
            } else if (this.accountIdCache.has(cached.id)) {
                cached.accountId = this.accountIdCache.get(cached.id);
            }
        }
        return settings;
    }

    async getGroupAccountId(groupId: string): Promise<string | undefined> {
        if (this.accountIdCache.has(groupId)) {
            return this.accountIdCache.get(groupId);
        }
        try {
            const settings = await this.getSettings();
            const accountId = settings.groupCache.find(g => g.id === groupId)?.accountId;
            this.accountIdCache.set(groupId, accountId);
            return accountId;
        } catch {
            return undefined;
        }
    }

    async updateGroupAccount(groupId: string, accountId: string): Promise<void> {
        this.accountIdCache.set(groupId, accountId);
        const settings = await this.getSettings();
        const cached = settings.groupCache.find(g => g.id === groupId);
        if (cached) {
            const nowIso = new Date().toISOString();
            cached.accountId = accountId;
            cached.lastAccessed = nowIso;
            cached.updatedAt = nowIso;
            await this.saveSettings(settings);
        }
    }

    async getSettings(): Promise<UserSettings> {
        if (this.db) {
            const localDoc = await this.db.user_settings.findOne("global_settings").exec();
            if (localDoc && !localDoc.deletedAt) {
                return this.syncAccountIdCache(docToUserSettings(localDoc.toJSON()));
            }
            if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
                return {
                    version: 2,
                    activeGroupId: null,
                    groupCache: [],
                    archivedGroupCache: [],
                    preferences: { defaultCurrency: "USD", theme: "system" },
                    lastUpdated: new Date().toISOString()
                };
            }
        }

        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;

        if (this.blobDriver) {
            let blobData: any = null;
            try {
                blobData = await this.blobDriver.readBlob<any>(SETTINGS_FILE_NAME);
            } catch (blobErr: any) {
                if (isOffline) {
                    return {
                        version: 2,
                        activeGroupId: null,
                        groupCache: [],
                        archivedGroupCache: [],
                        preferences: { defaultCurrency: "USD", theme: "system" },
                        lastUpdated: new Date().toISOString()
                    };
                }
                throw blobErr;
            }

            if (blobData) {
                const raw = Array.isArray(blobData) ? blobData[0] : blobData;
                if (raw && raw.version) {
                    const settings = this.syncAccountIdCache(raw.id ? docToUserSettings(raw) : (raw as UserSettings));
                    if (this.db) {
                        const doc = userSettingsToDoc(settings);
                        await this.db.user_settings.upsert(doc);
                        ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [doc]);
                    }
                    return settings;
                }
            }
        }

        let files: any[] = [];
        try {
            files = await this.storage.listFiles(`name = '${SETTINGS_FILE_NAME}' and trashed = false`);
        } catch (storageErr: any) {
            if (isOffline) {
                return {
                    version: 2,
                    activeGroupId: null,
                    groupCache: [],
                    archivedGroupCache: [],
                    preferences: { defaultCurrency: "USD", theme: "system" },
                    lastUpdated: new Date().toISOString()
                };
            }
            throw storageErr;
        }

        if (files.length > 0) {
            let fileToUse = files[0];
            // Self-healing: clean up duplicate settings files if they occur
            if (files.length > 1) {
                const sortedFiles = files.sort((a: any, b: any) => new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime());
                fileToUse = sortedFiles[0];
                for (const dup of sortedFiles.slice(1)) {
                    await this.storage.deleteFile(dup.id).catch(() => { });
                }
            }
            try {
                const data = await this.storage.getFile(fileToUse.id, { alt: 'media' });
                if (data && data.version) {
                    const settings = this.syncAccountIdCache(data as UserSettings);
                    if (this.db) {
                        const doc = userSettingsToDoc(settings);
                        await this.db.user_settings.upsert(doc);
                        ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [doc]);
                    }
                    return settings;
                }
            } catch (e: any) {
                if (isOffline) {
                    return {
                        version: 2,
                        activeGroupId: null,
                        groupCache: [],
                        archivedGroupCache: [],
                        preferences: { defaultCurrency: "USD", theme: "system" },
                        lastUpdated: new Date().toISOString()
                    };
                }
                throw e;
            }
        }
        return this.reconcileGroups();
    }

    async saveSettings(settings: UserSettings): Promise<void> {
        this.syncAccountIdCache(settings);
        const nowIso = new Date().toISOString();
        settings.lastUpdated = nowIso;

        if (this.db) {
            try {
                const existingDoc = await this.db.user_settings.findOne("global_settings").exec();
                if (existingDoc && !existingDoc.deletedAt) {
                    const prev = existingDoc.toJSON();
                    const prefsChanged = JSON.stringify(prev.preferences || {}) !== JSON.stringify(settings.preferences || {});
                    const keyChanged = prev.encryptedApiKey !== settings.encryptedApiKey;
                    if (prefsChanged || keyChanged || !settings.preferencesUpdatedAt) {
                        settings.preferencesUpdatedAt = nowIso;
                    } else {
                        settings.preferencesUpdatedAt = prev.preferencesUpdatedAt;
                    }
                } else {
                    settings.preferencesUpdatedAt = settings.preferencesUpdatedAt || nowIso;
                }
            } catch {
                settings.preferencesUpdatedAt = settings.preferencesUpdatedAt || nowIso;
            }
            await this.db.user_settings.upsert(userSettingsToDoc(settings));
            const isMockE2E =
                typeof globalThis !== "undefined" &&
                (globalThis as any).localStorage?.getItem?.("quozen_access_token") === "mock-token-123";
            const isOffline =
                typeof globalThis !== "undefined" &&
                (globalThis as any).navigator?.onLine === false;
            if (isOffline || (this.onMutation && !isMockE2E)) {
                await this.onMutation?.(settings.activeGroupId || undefined);
                return;
            }
            if (!this.blobDriver && !isMockE2E) {
                return;
            }
        } else {
            settings.preferencesUpdatedAt = settings.preferencesUpdatedAt || nowIso;
        }

        if (this.blobDriver) {
            try {
                await this.blobDriver.writeBlob(SETTINGS_FILE_NAME, [userSettingsToDoc(settings)]);
                if (this.db) {
                    ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [userSettingsToDoc(settings)]);
                }
                return;
            } catch (err) {
                if (this.db && isNetworkError(err)) {
                    return;
                }
                // Fall back to storage if blobDriver fails in mock environment
            }
        }

        try {
            const files = await this.storage.listFiles(`name = '${SETTINGS_FILE_NAME}' and trashed = false`);
            if (files.length > 0) {
                let fileToUse = files[0];
                // Self-healing: clean up duplicates before updating
                if (files.length > 1) {
                    const sortedFiles = files.sort((a: any, b: any) => new Date(a.createdTime || 0).getTime() - new Date(b.createdTime || 0).getTime());
                    fileToUse = sortedFiles[0];
                    for (const dup of sortedFiles.slice(1)) {
                        await this.storage.deleteFile(dup.id).catch(() => { });
                    }
                }
                await this.storage.updateFile(fileToUse.id, {}, JSON.stringify(settings));
            } else {
                await this.storage.createFile(SETTINGS_FILE_NAME, "application/json", {}, JSON.stringify(settings));
            }
            if (this.db) {
                ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [userSettingsToDoc(settings)]);
            }
        } catch (err) {
            if (this.db && isNetworkError(err)) {
                return;
            }
            throw err;
        }
    }

    async reconcileGroups(): Promise<UserSettings> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "reconcileGroups");
        }

        let existingSettings: UserSettings | null = null;
        if (this.db) {
            try {
                const doc = await this.db.user_settings.findOne("global_settings").exec();
                if (doc && !doc.deletedAt) {
                    existingSettings = docToUserSettings(doc.toJSON());
                }
            } catch {}
        } else {
            try {
                const sFiles = await this.storage.listFiles(`name = '${SETTINGS_FILE_NAME}' and trashed = false`);
                if (sFiles.length > 0) {
                    const data = await this.storage.getFile(sFiles[0].id, { alt: 'media' });
                    if (data && data.version) {
                        existingSettings = data as UserSettings;
                    }
                }
            } catch {}
        }

        const files = await this.storage.listFiles(`properties has { key='quozen_type' and value='group' } and trashed = false`);
        const existingGroupMap = new Map<string, CachedGroup>();
        if (existingSettings?.groupCache) {
            for (const g of existingSettings.groupCache) {
                if (g && g.id) existingGroupMap.set(g.id, g);
            }
        }

        const archivedIds = new Set((existingSettings?.archivedGroupCache || []).map(g => g.id));
        const filteredFiles = files.filter(f => !archivedIds.has(f.id));

        const visibleGroups: CachedGroup[] = filteredFiles.map(file => {
            const existing = existingGroupMap.get(file.id);
            const accountId = this.accountIdCache.get(file.id) || existing?.accountId;
            return {
                id: file.id,
                name: file.name.startsWith(QUOZEN_PREFIX) ? file.name.slice(QUOZEN_PREFIX.length) : file.name,
                role: (file.owners?.some((o: any) => o.emailAddress === this.user.email) || file.capabilities?.canDelete) ? ("owner" as const) : ("member" as const),
                ...(accountId ? { accountId } : {}),
                lastAccessed: existing?.lastAccessed || file.createdTime,
                ...(existing?.isHydrated !== undefined ? { isHydrated: existing.isHydrated } : {}),
                ...(existing?.pendingRename !== undefined ? { pendingRename: existing.pendingRename } : {}),
                ...(existing?.validationStatus !== undefined ? { validationStatus: existing.validationStatus } : {}),
                ...(existing?.updatedAt ? { updatedAt: existing.updatedAt } : {}),
                ...(existing?.icon !== undefined ? { icon: existing.icon } : {})
            };
        }).sort((a, b) => new Date(b.lastAccessed || 0).getTime() - new Date(a.lastAccessed || 0).getTime());

        const activeGroupId = existingSettings?.activeGroupId && visibleGroups.some(g => g.id === existingSettings.activeGroupId)
            ? existingSettings.activeGroupId
            : visibleGroups[0]?.id || null;

        const nowIso = new Date().toISOString();
        const settings: UserSettings = {
            version: existingSettings?.version || 3,
            activeGroupId,
            groupCache: visibleGroups,
            archivedGroupCache: existingSettings?.archivedGroupCache || [],
            preferences: existingSettings?.preferences ? { ...existingSettings.preferences } : { defaultCurrency: "USD", theme: "system" },
            ...(existingSettings?.preferencesUpdatedAt ? { preferencesUpdatedAt: existingSettings.preferencesUpdatedAt } : {}),
            ...(existingSettings?.encryptedApiKey ? { encryptedApiKey: existingSettings.encryptedApiKey } : {}),
            lastUpdated: nowIso
        };
        await this.saveSettings(settings);
        return settings;
    }

    private async checkFileHealth(groupId: string): Promise<{ available: boolean; reason?: "trashed" | "deleted" }> {
        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;
        if (isOffline) {
            return { available: true };
        }
        try {
            const meta = await this.storage.getFile(groupId, { fields: "id,name,trashed" });
            if (meta?.trashed) {
                return { available: false, reason: "trashed" };
            }
            return { available: true };
        } catch (err: any) {
            const msg = (err?.message || "").toLowerCase();
            if (msg.includes("404") || msg.includes("not found") || msg.includes("410") || err?.name === "NotFoundError") {
                return { available: false, reason: "deleted" };
            }
            if (isNetworkError(err)) {
                return { available: true };
            }
            throw err;
        }
    }

    async purgeUnavailableGroup(groupId: string, groupName?: string, reason: "trashed" | "deleted" = "deleted"): Promise<void> {
        this.accountIdCache.delete(groupId);
        const settings = await this.getSettings();
        const cached = settings.groupCache.find(g => g.id === groupId) || settings.archivedGroupCache?.find(g => g.id === groupId);
        const resolvedName = groupName || cached?.name || "Group";

        settings.groupCache = settings.groupCache.filter(g => g.id !== groupId);
        if (settings.archivedGroupCache) {
            settings.archivedGroupCache = settings.archivedGroupCache.filter(g => g.id !== groupId);
        }

        const wasActive = settings.activeGroupId === groupId;
        if (wasActive) {
            settings.activeGroupId = settings.groupCache[0]?.id || null;
        }
        const nowIso = new Date().toISOString();
        settings.lastUpdated = nowIso;

        await this.saveSettings(settings);

        if (this.db) {
            try {
                ReplicationCoordinator.unmarkGroupHydrated(this.db.name, groupId);
                await Promise.all([
                    (this.db as any).expenses?.find({ selector: { groupId } }).remove(),
                    (this.db as any).settlements?.find({ selector: { groupId } }).remove(),
                    (this.db as any).members?.find({ selector: { groupId } }).remove(),
                    (this.db as any).categories?.find({ selector: { groupId } }).remove(),
                ]);
            } catch (err) {
                console.warn("[GroupRepository] Failed to purge RxDB collections for group", groupId, err);
            }
        }

        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
            window.dispatchEvent(new CustomEvent("group-file-unavailable", {
                detail: {
                    groupId,
                    groupName: resolvedName,
                    reason,
                    fallbackGroupId: settings.activeGroupId,
                    hasRemainingGroups: settings.groupCache.length > 0
                }
            }));
        }
    }

    async updateActiveGroup(groupId: string): Promise<void> {
        const settings = await this.getSettings();
        const cached = settings.groupCache.find(g => g.id === groupId);
        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;

        if (settings.activeGroupId === groupId) {
            if (cached?.icon !== undefined) {
                return;
            }
            if (cached && !isOffline && this.storage) {
                try {
                    const metaRes = await this.storage.batchGetValues(groupId, ["_meta!A1:C10"]);
                    const metaRows = metaRes[0]?.values || [];
                    const iconRow = metaRows.find((r: any[]) => r[0] === "icon");
                    cached.icon = (iconRow && iconRow[1]) ? iconRow[1] : "";
                } catch {
                    cached.icon = "";
                }
                await this.saveSettings(settings);
            }
            return;
        }

        const health = await this.checkFileHealth(groupId);
        if (!health.available) {
            await this.purgeUnavailableGroup(groupId, cached?.name, health.reason);
            throw new GroupFileUnavailableError(groupId, cached?.name, health.reason);
        }

        if (this.db) {
            if (cached?.validationStatus === ValidationStatus.CORRUPTED || cached?.validationStatus === ValidationStatus.INCOMPATIBLE) {
                throw new Error("Cannot activate a corrupted group. Please repair it first.");
            }
            settings.activeGroupId = groupId;
            if (cached) {
                cached.lastAccessed = new Date().toISOString();
                if (cached.icon === undefined && !isOffline) {
                    try {
                        const metaRes = await this.storage.batchGetValues(groupId, ["_meta!A1:C10"]);
                        const metaRows = metaRes[0]?.values || [];
                        const iconRow = metaRows.find((r: any[]) => r[0] === "icon");
                        cached.icon = (iconRow && iconRow[1]) ? iconRow[1] : "";
                    } catch {
                        cached.icon = "";
                    }
                }
            }
            await this.saveSettings(settings);
            return;
        }

        if (!isOffline) {
            const validation = await this.validateQuozenSpreadsheet(groupId);
            if (validation.status === ValidationStatus.CORRUPTED || validation.status === ValidationStatus.INCOMPATIBLE) {
                throw new Error("Cannot activate a corrupted group. Please repair it first.");
            }
            if (cached && validation.status) {
                cached.validationStatus = validation.status;
            }
        }

        settings.activeGroupId = groupId;
        if (cached) {
            cached.lastAccessed = new Date().toISOString();
            if (cached.icon === undefined && !isOffline) {
                try {
                    const metaRes = await this.storage.batchGetValues(groupId, ["_meta!A1:C10"]);
                    const metaRows = metaRes[0]?.values || [];
                    const iconRow = metaRows.find((r: any[]) => r[0] === "icon");
                    cached.icon = (iconRow && iconRow[1]) ? iconRow[1] : "";
                } catch {
                    cached.icon = "";
                }
            }
        }
        await this.saveSettings(settings);
    }

    async archiveGroup(groupId: string): Promise<void> {
        const settings = await this.getSettings();
        const cached = settings.groupCache.find(g => g.id === groupId);
        const groupName = cached?.name;

        const health = await this.checkFileHealth(groupId);
        if (!health.available) {
            await this.purgeUnavailableGroup(groupId, groupName, health.reason);
            throw new GroupFileUnavailableError(groupId, groupName, health.reason);
        }

        if (!settings.archivedGroupCache) {
            settings.archivedGroupCache = [];
        }

        const nowIso = new Date().toISOString();
        const base = cached || (settings.archivedGroupCache || []).find(g => g.id === groupId);
        settings.groupCache = settings.groupCache.filter(g => g.id !== groupId);
        settings.archivedGroupCache = [
            {
                ...(base || { id: groupId, name: groupName || "Archived Group", role: "member" as const }),
                isArchived: true,
                lastAccessed: nowIso,
                updatedAt: nowIso
            },
            ...settings.archivedGroupCache.filter(g => g.id !== groupId)
        ];

        if (settings.activeGroupId === groupId) {
            settings.activeGroupId = settings.groupCache[0]?.id || null;
        }

        this.accountIdCache.delete(groupId);
        await this.saveSettings(settings);
    }

    async unarchiveGroup(groupId: string): Promise<void> {
        const settings = await this.getSettings();
        const archived = settings.archivedGroupCache?.find(g => g.id === groupId);
        const groupName = archived?.name;

        const health = await this.checkFileHealth(groupId);
        if (!health.available) {
            await this.purgeUnavailableGroup(groupId, groupName, health.reason);
            throw new GroupFileUnavailableError(groupId, groupName, health.reason);
        }

        if (settings.archivedGroupCache) {
            settings.archivedGroupCache = settings.archivedGroupCache.filter(g => g.id !== groupId);
        }

        const nowIso = new Date().toISOString();
        const base = archived || settings.groupCache.find(g => g.id === groupId);
        settings.groupCache = [
            {
                ...(base || { id: groupId, name: groupName || "Group", role: "member" as const }),
                isArchived: false,
                lastAccessed: nowIso,
                updatedAt: nowIso
            },
            ...settings.groupCache.filter(g => g.id !== groupId)
        ];

        const targetGroup = settings.groupCache.find(g => g.id === groupId);
        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;
        if (targetGroup && !targetGroup.icon && !isOffline) {
            try {
                const metaRes = await this.storage.batchGetValues(groupId, ["_meta!A1:C10"]);
                const metaRows = metaRes[0]?.values || [];
                const iconRow = metaRows.find((r: any[]) => r[0] === "icon");
                if (iconRow && iconRow[1]) {
                    targetGroup.icon = iconRow[1];
                }
            } catch {}
        }

        settings.activeGroupId = groupId;
        await this.saveSettings(settings);
    }

    async create(name: string, members: MemberInput[] = [], options?: { icon?: string }): Promise<Group> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("Creating a group requires an internet connection.", "createGroup");
        }

        const title = `${QUOZEN_PREFIX}${name}`;
        const fileId = await this.storage.createSpreadsheet(title, [...GROUP_SHEETS], {
            quozen_type: 'group',
            version: '1.0',
            quozen_schema_version: String(QuozenSchema.version)
        });

        const nowIso = new Date().toISOString();
        const initialMembers = [
            [this.user.id || "unknown", this.user.email, this.user.name, "owner", nowIso, nowIso]
        ];

        for (const member of members) {
            let memberName = member.username || member.email || "Unknown";
            let memberId = member.email || member.username || `user-${crypto.randomUUID()}`;
            if (member.email) {
                const perm = await this.storage.createPermission(fileId, "writer", "user", member.email);
                if (perm.displayName) memberName = perm.displayName;
                memberId = member.email;
            }
            initialMembers.push([memberId, member.email || "", memberName, "member", nowIso, nowIso]);
        }

        const initialCategories = DEFAULT_CATEGORIES.map(c => [
            c.id,
            c.name,
            c.icon || "",
            c.description || "",
            nowIso,
            ""
        ]);

        const metaRows: string[][] = [
            ["key", "value", "updatedAt"]
        ];
        if (options?.icon) {
            if (options.icon.length <= 49000) {
                metaRows.push(["icon", options.icon, nowIso]);
            } else {
                console.warn("[GroupRepository] Icon exceeds Google Sheets single cell limit (50000 chars), skipping _meta write");
            }
        }

        const dataToUpdate = [
            { range: "Expenses!A1", values: [[...SCHEMAS.Expenses]] },
            { range: "Settlements!A1", values: [[...SCHEMAS.Settlements]] },
            { range: "Members!A1", values: [[...SCHEMAS.Members]] },
            { range: "Members!A2", values: initialMembers },
            { range: "Categories!A1", values: [[...SCHEMAS.Categories]] },
            { range: "Categories!A2", values: initialCategories },
            { range: "_migrations!A1", values: [["version", "migrated_at"]] },
            { range: "_migrations!A2", values: [[QuozenSchema.version, nowIso]] },
            { range: "_meta!A1", values: metaRows }
        ];

        await this.storage.batchUpdateValues(fileId, dataToUpdate);

        if (this.db) {
            const memberDocs = initialMembers.map(row =>
                memberToDoc(
                    {
                        userId: String(row[0]),
                        email: String(row[1] || ""),
                        name: String(row[2] || ""),
                        role: row[3] === "owner" ? "owner" : "member",
                        joinedAt: new Date(row[4]),
                        updatedAt: new Date(row[5] || row[4])
                    },
                    fileId
                )
            );
            await this.db.members.bulkUpsert(memberDocs);
            ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, memberDocs);

            const categoryDocs = DEFAULT_CATEGORIES.map(cat => categoryToDoc({ ...cat, updatedAt: new Date(nowIso) }, fileId));
            await this.db.collections.categories.bulkUpsert(categoryDocs);
            ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, categoryDocs);
            ReplicationCoordinator.markGroupHydrated(this.db.name, fileId);
        }

        if (this.getToken && this.getToken()) {
            try {
                const validationSvc = new ValidationService(this.getToken);
                await validationSvc.initializeFile(fileId);
            } catch (e) {
                console.warn("Failed to initialize file schema on create", e);
            }
        }

        const settings = await this.getSettings();
        const existingCached = settings.groupCache.find(g => g.id === fileId);
        if (existingCached) {
            existingCached.name = name;
            existingCached.role = "owner";
            existingCached.lastAccessed = nowIso;
            existingCached.updatedAt = nowIso;
            existingCached.validationStatus = ValidationStatus.READY;
            existingCached.isHydrated = true;
            existingCached.icon = options?.icon || "";
        } else {
            settings.groupCache.unshift({
                id: fileId,
                name,
                role: "owner",
                lastAccessed: nowIso,
                updatedAt: nowIso,
                validationStatus: ValidationStatus.READY,
                isHydrated: true,
                icon: options?.icon || ""
            });
        }
        settings.activeGroupId = fileId;
        await this.saveSettings(settings);

        return {
            id: fileId, name, description: "Google Sheet Group",
            createdBy: "me",
            participants: initialMembers.map(m => m[0]),
            createdAt: new Date(),
            isOwner: true,
            ...(options?.icon ? { icon: options.icon } : {})
        };
    }

    async setGroupPermissions(groupId: string, access: 'public' | 'restricted'): Promise<void> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "changePermissions");
        }

        if (access === 'public') {
            await this.storage.createPermission(groupId, "writer", "anyone");
        } else {
            // When restricting access, ensure all members who joined via link retain explicit user permissions
            try {
                const res = await this.storage.batchGetValues(groupId, ["Members!A1:Z"]);
                const memberRows = res[0]?.values || [];
                if (memberRows.length > 1) {
                    const headers = SheetDataMapper.buildHeaderMap(memberRows[0]);
                    const members = memberRows.slice(1).map((r: any[], i: number) => SheetDataMapper.mapToMember(r, i + 2, headers).entity);
                    const existingPerms = await this.storage.listPermissions(groupId);
                    const existingEmails = new Set(
                        existingPerms
                            .filter((p: any) => p.type === 'user' && (p.emailAddress || p.email))
                            .map((p: any) => (p.emailAddress || p.email).toLowerCase())
                    );

                    for (const m of members) {
                        if (m.email && m.role !== 'owner' && !existingEmails.has(m.email.toLowerCase())) {
                            try {
                                await this.storage.createPermission(groupId, "writer", "user", m.email);
                            } catch (e) {
                                console.warn(`Could not add explicit permission for member ${m.email}:`, e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Could not verify member permissions before restricting group:", e);
            }

            const permissions = await this.storage.listPermissions(groupId);
            const publicPerm = permissions.find((p: any) => p.type === 'anyone');
            if (publicPerm) {
                await this.storage.deletePermission(groupId, publicPerm.id);
            }
        }
    }

    async getGroupPermissions(groupId: string): Promise<'public' | 'restricted'> {
        try {
            const permissions = await this.storage.listPermissions(groupId);
            const publicPerm = permissions.find((p: any) => p.type === 'anyone');
            return publicPerm ? 'public' : 'restricted';
        } catch (e) {
            console.error("Failed to get permissions", e);
            return 'restricted';
        }
    }

    async validateQuozenSpreadsheet(spreadsheetId: string): Promise<{ valid: boolean; status?: ValidationStatus; error?: string; name?: string; members?: Member[] }> {
        try {
            const meta = await this.storage.getFile(spreadsheetId, { fields: "name,properties" });
            const sheetMeta = await this.storage.getSpreadsheet(spreadsheetId, "properties.title,sheets.properties.title");

            const titles = sheetMeta.sheets?.map((s: any) => s.properties.title) || [];
            if (!REQUIRED_SHEETS.every((t: string) => titles.includes(t))) {
                return { valid: false, status: ValidationStatus.CORRUPTED, error: "Missing tabs" };
            }

            let status = ValidationStatus.READY;
            if (this.getToken && this.getToken()) {
                try {
                    const validationSvc = new ValidationService(this.getToken);
                    const health = await validationSvc.checkHealth(spreadsheetId);
                    status = health.status;
                } catch (e: any) {
                    console.warn("ValidationService check failed", e);
                    if (!isNetworkError(e)) {
                        status = ValidationStatus.CORRUPTED;
                    }
                }
            }

            const res = await this.storage.batchGetValues(spreadsheetId, ["Members!A2:Z"]);
            const memberRows = res[0]?.values || [];
            const members = memberRows.map((r: any[], i: number) => SheetDataMapper.mapToMember(r, i + 2).entity);

            return { valid: status !== ValidationStatus.CORRUPTED && status !== ValidationStatus.INCOMPATIBLE, status, name: meta.name || sheetMeta.properties?.title, members };
        } catch (e: any) {
            if (this.db && isNetworkError(e)) {
                return { valid: true, status: ValidationStatus.READY };
            }
            return { valid: false, status: ValidationStatus.CORRUPTED, error: e.message };
        }
    }

    async importGroup(spreadsheetId: string, options?: { accountId?: string }): Promise<Group> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "importGroup");
        }

        const meta = await this.storage.getFile(spreadsheetId, { fields: "name,properties" });
        if (meta.properties?.quozen_type !== 'group') {
            const validation = await this.validateQuozenSpreadsheet(spreadsheetId);
            if (!validation.valid) throw new Error("Invalid Quozen Group. Missing required sheets.");
            await this.storage.updateFile(spreadsheetId, { properties: { quozen_type: 'group', version: '1.0' } });
        }

        const validation = await this.validateQuozenSpreadsheet(spreadsheetId);

        const settings = await this.getSettings();
        const existingCachedGroup = settings.groupCache.find(g => g.id === spreadsheetId);
        const linkedAccountId = options?.accountId || existingCachedGroup?.accountId || this.accountIdCache.get(spreadsheetId);
        if (linkedAccountId) {
            this.accountIdCache.set(spreadsheetId, linkedAccountId);
        }

        let role: "owner" | "member" = "member";
        if (validation.members) {
            if (this.db && validation.members.length > 0) {
                const memberDocs = validation.members
                    .filter(m => Boolean(m.userId))
                    .map(m => memberToDoc(m, spreadsheetId));
                if (memberDocs.length > 0) {
                    await this.db.members.bulkUpsert(memberDocs);
                    ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, memberDocs);
                }
            }

            const member = linkedAccountId
                ? validation.members.find(m => m.userId === linkedAccountId)
                : validation.members.find(m => m.email === this.user.email || m.userId === this.user.id);
            if (member?.role === "owner") role = "owner";
            
            if (!linkedAccountId && member && member.userId !== this.user.id) {
                const ledgerRepo = new LedgerRepository(this.storage, spreadsheetId, this.db, () => this.onMutation?.(spreadsheetId));
                await ledgerRepo.migrateUser(member.userId, this.user.id, this.user.name);
            }
        }

        const groupName = validation.name || "Imported Group";
        const cleanName = groupName.startsWith(QUOZEN_PREFIX) ? groupName.slice(QUOZEN_PREFIX.length) : groupName;

        if (settings.archivedGroupCache) {
            settings.archivedGroupCache = settings.archivedGroupCache.filter(g => g.id !== spreadsheetId);
        }

        const nowIso = new Date().toISOString();
        const cachedGroup = settings.groupCache.find(g => g.id === spreadsheetId);
        let groupIcon = cachedGroup?.icon || existingCachedGroup?.icon;
        try {
            const metaRes = await this.storage.batchGetValues(spreadsheetId, ["_meta!A1:C10"]);
            const metaRows = metaRes[0]?.values || [];
            const iconRow = metaRows.find((r: string[]) => r[0] === "icon");
            if (iconRow && iconRow[1]) {
                groupIcon = iconRow[1];
            }
        } catch {
            // Older sheets might not have _meta tab
        }

        if (!cachedGroup) {
            settings.groupCache.unshift({
                id: spreadsheetId,
                name: cleanName,
                role,
                ...(linkedAccountId ? { accountId: linkedAccountId } : {}),
                lastAccessed: nowIso,
                updatedAt: nowIso,
                validationStatus: validation.status,
                isArchived: false,
                ...(groupIcon ? { icon: groupIcon } : {})
            });
        } else {
            cachedGroup.role = role;
            if (linkedAccountId) {
                cachedGroup.accountId = linkedAccountId;
            }
            if (groupIcon) {
                cachedGroup.icon = groupIcon;
            }
            cachedGroup.isArchived = false;
            cachedGroup.lastAccessed = nowIso;
            cachedGroup.updatedAt = nowIso;
            cachedGroup.validationStatus = validation.status;
        }

        if (validation.status !== ValidationStatus.CORRUPTED && validation.status !== ValidationStatus.INCOMPATIBLE) {
            settings.activeGroupId = spreadsheetId;
        }
        await this.saveSettings(settings);

        return {
            id: spreadsheetId,
            name: cleanName,
            description: "Imported",
            createdBy: "Unknown",
            participants: [],
            createdAt: new Date(),
            isOwner: role === "owner",
            ...(groupIcon ? { icon: groupIcon } : {})
        };
    }

    async joinGroup(spreadsheetId: string, options?: { accountId?: string }): Promise<Group> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "joinGroup");
        }

        const meta = await this.storage.getFile(spreadsheetId, { fields: "name,properties" });
        if (meta.properties?.quozen_type !== 'group') {
            throw new Error("This file is not a valid Quozen Group.");
        }

        const validation = await this.validateQuozenSpreadsheet(spreadsheetId);
        if (!validation.valid) throw new Error("Could not read group data");

        // Ensure joining user receives explicit Google Drive permission so they don't lose access when link becomes restricted
        if (this.user.email) {
            try {
                await this.storage.createPermission(spreadsheetId, "writer", "user", this.user.email);
            } catch (e) {
                console.warn("Could not set explicit permission during joinGroup", e);
            }
        }

        await this.storage.updateFile(spreadsheetId, {
            properties: { _lastSyncTrigger: new Date().toISOString() }
        }).catch(() => {});

        if (options?.accountId) {
            const targetAccount = validation.members?.find(m => m.userId === options.accountId);
            if (!targetAccount) {
                throw new Error("Selected account not found in this group.");
            }
            this.accountIdCache.set(spreadsheetId, options.accountId);
            return await this.importGroup(spreadsheetId, { accountId: options.accountId });
        }

        const existingMember = validation.members?.find(m => m.userId === this.user.id || m.email === this.user.email);
        if (!existingMember) {
            const newMember: Member = {
                userId: this.user.id,
                email: this.user.email,
                name: this.user.name,
                role: "member",
                joinedAt: new Date(),
                updatedAt: new Date()
            };
            const row = SheetDataMapper.mapFromMember(newMember);
            await this.storage.appendValues(spreadsheetId, "Members!A1", [row]);
            if (this.db && newMember.userId) {
                const doc = memberToDoc(newMember, spreadsheetId);
                await this.db.members.upsert(doc);
                ReplicationCoordinator.recordHydratedCheckpoints(this.db.name, [doc]);
            }
        }

        return await this.importGroup(spreadsheetId);
    }

    async deleteGroup(groupId: string): Promise<void> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "deleteGroup");
        }
        await this.storage.deleteFile(groupId);
        await this.purgeUnavailableGroup(groupId, undefined, "deleted");
    }

    async checkMemberHasExpenses(groupId: string, userId: string): Promise<boolean> {
        const ledgerRepo = new LedgerRepository(this.storage, groupId, this.db);
        const expenses = await ledgerRepo.getExpenses();
        return expenses.some(e => e.paidByUserId === userId || e.splits.some(s => s.userId === userId && s.amount > 0));
    }

    async updateGroup(groupId: string, name: string, members: MemberInput[], options?: { icon?: string }): Promise<void> {
        const health = await this.checkFileHealth(groupId);
        if (!health.available) {
            const settings = await this.getSettings();
            const cached = settings.groupCache.find(g => g.id === groupId) || settings.archivedGroupCache?.find(g => g.id === groupId);
            await this.purgeUnavailableGroup(groupId, cached?.name || name, health.reason);
            throw new GroupFileUnavailableError(groupId, cached?.name || name, health.reason);
        }

        const newTitle = `${QUOZEN_PREFIX}${name}`;
        const isOffline = typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false;

        const ledgerRepo = new LedgerRepository(this.storage, groupId, this.db, () => this.onMutation?.(groupId));
        const currentMembers = await ledgerRepo.getMembers();

        const processedIds = new Set<string>();
        const desiredMembers = members.map(m => ({ id: m.email || m.username || "", ...m })).filter(m => m.id);

        for (const desired of desiredMembers) {
            const existing = currentMembers.find(c =>
                (desired.email && c.email && c.email.trim().toLowerCase() === desired.email.trim().toLowerCase()) ||
                (desired.username && (
                    c.userId.trim().toLowerCase() === desired.username.trim().toLowerCase() ||
                    c.name.trim().toLowerCase() === desired.username.trim().toLowerCase() ||
                    (c.email && c.email.trim().toLowerCase() === desired.username.trim().toLowerCase())
                ))
            );

            if (existing) {
                processedIds.add(existing.userId);
            } else {
                if (desired.email && isOffline) {
                    throw new OfflineOperationError("Inviting members by email requires an internet connection to grant Google Drive permissions.", "inviteEmail");
                }

                let memberName = desired.username || desired.email || "Unknown";
                let memberId = desired.username || desired.email || `user-${crypto.randomUUID()}`;
                if (desired.email && !isOffline) {
                    try {
                        const perm = await this.storage.createPermission(groupId, "writer", "user", desired.email);
                        if (perm?.displayName) memberName = perm.displayName;
                        memberId = desired.email;
                    } catch (err) {
                        if (!this.db || !isNetworkError(err)) throw err;
                        memberId = desired.email;
                    }
                } else if (desired.email) {
                    memberId = desired.email;
                }
                await ledgerRepo.addMember({
                    userId: memberId,
                    email: desired.email || "",
                    name: memberName,
                    role: "member",
                    joinedAt: new Date(),
                    updatedAt: new Date()
                });
                processedIds.add(memberId);
            }
        }

        const membersToDelete = currentMembers.filter(m => !processedIds.has(m.userId) && m.role !== 'owner');
        for (const m of membersToDelete) {
            if (await this.checkMemberHasExpenses(groupId, m.userId)) throw new Error(`Cannot remove ${m.name} because they have expenses.`);
            await ledgerRepo.deleteMember(m.userId);
        }

        if (!isOffline && options?.icon !== undefined) {
            if (options.icon.length > 49000) {
                console.warn("[GroupRepository] Icon exceeds Google Sheets single cell limit (50000 chars), skipping _meta write");
            } else {
                try {
                    let metaRows: any[][] = [];
                    try {
                        const metaRes = await this.storage.batchGetValues(groupId, ["_meta!A1:C20"]);
                        metaRows = metaRes[0]?.values || [];
                    } catch {
                        // _meta tab might not exist in older spreadsheets
                    }

                    const nowIso = new Date().toISOString();
                    if (metaRows.length === 0) {
                        metaRows = [
                            ["key", "value", "updatedAt"],
                            ["icon", options.icon, nowIso]
                        ];
                        await this.storage.batchUpdateValues(groupId, [
                            { range: "_meta!A1", values: metaRows }
                        ]);
                    } else {
                        const iconIndex = metaRows.findIndex(r => r[0] === "icon");
                        if (iconIndex >= 0) {
                            metaRows[iconIndex] = ["icon", options.icon, nowIso];
                            await this.storage.batchUpdateValues(groupId, [
                                { range: `_meta!A${iconIndex + 1}:C${iconIndex + 1}`, values: [["icon", options.icon, nowIso]] }
                            ]);
                        } else {
                            const nextRow = metaRows.length + 1;
                            await this.storage.batchUpdateValues(groupId, [
                                { range: `_meta!A${nextRow}:C${nextRow}`, values: [["icon", options.icon, nowIso]] }
                            ]);
                        }
                    }
                } catch (metaErr) {
                    console.warn("Could not sync _meta tab:", metaErr);
                }
            }
        }

        const settings = await this.getSettings();
        const cachedGroup = settings.groupCache.find(g => g.id === groupId);
        const nameChanged = !cachedGroup || cachedGroup.name !== name;

        let pendingRename = Boolean(cachedGroup?.pendingRename);
        if (nameChanged) {
            if (!isOffline) {
                try {
                    await this.storage.updateFile(groupId, { name: newTitle });
                    pendingRename = false;
                } catch (err) {
                    if (this.db && isNetworkError(err)) {
                        pendingRename = true;
                    } else if (!this.db) {
                        throw err;
                    }
                }
            } else {
                pendingRename = true;
            }
        }

        if (cachedGroup) {
            const renameChanged = cachedGroup.pendingRename !== pendingRename;
            const iconChanged = options?.icon !== undefined && cachedGroup.icon !== options.icon;
            cachedGroup.name = name;
            cachedGroup.pendingRename = pendingRename;
            if (options?.icon !== undefined) {
                cachedGroup.icon = options.icon;
            }
            if (nameChanged || renameChanged || iconChanged) {
                cachedGroup.updatedAt = new Date().toISOString();
                await this.saveSettings(settings);
            }
        }
    }

    async leaveGroup(groupId: string): Promise<void> {
        if (typeof globalThis !== "undefined" && (globalThis as any).navigator?.onLine === false) {
            throw new OfflineOperationError("This operation requires an internet connection.", "leaveGroup");
        }

        const settings = await this.getSettings();
        const cachedGroup = settings.groupCache.find(g => g.id === groupId);
        const linkedAccountId = cachedGroup?.accountId || this.accountIdCache.get(groupId);

        const ledgerRepo = new LedgerRepository(this.storage, groupId, this.db, () => this.onMutation?.(groupId));
        const currentMembers = await ledgerRepo.getMembers();
        const member = currentMembers.find(m => m.userId === this.user.id || (this.user.email && m.email === this.user.email));

        // If the user is sharing another account and has no personal member row in the sheet,
        // simply remove the group from their personal groupCache without deleting the shared member row.
        if (!member && linkedAccountId) {
            this.accountIdCache.delete(groupId);
            settings.groupCache = settings.groupCache.filter(g => g.id !== groupId);
            if (settings.activeGroupId === groupId) settings.activeGroupId = settings.groupCache[0]?.id || null;
            await this.saveSettings(settings);
            return;
        }

        if (!member) throw new Error("Member not found");
        if (member.role === 'owner') throw new Error("Owners cannot leave.");
        if (await this.checkMemberHasExpenses(groupId, member.userId)) throw new Error("Cannot leave with expenses.");

        await ledgerRepo.deleteMember(member.userId);
        this.accountIdCache.delete(groupId);
        settings.groupCache = settings.groupCache.filter(g => g.id !== groupId);
        if (settings.activeGroupId === groupId) settings.activeGroupId = settings.groupCache[0]?.id || null;
        await this.saveSettings(settings);
    }

    async repairGroup(groupId: string): Promise<void> {
        if (!this.getToken) throw new Error("Requires authentication to repair");
        const validationSvc = new ValidationService(this.getToken);
        await validationSvc.repairFile(groupId);
    }

    async migrateGroup(groupId: string): Promise<void> {
        if (!this.getToken) throw new Error("Requires authentication to migrate");
        const validationSvc = new ValidationService(this.getToken);
        await validationSvc.migrateFile(groupId);
    }
}
