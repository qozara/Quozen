import { IStorageLayer } from "./IStorageLayer";
import { Group, User, Member } from "../domain/models";
import { UserSettings, CachedGroup, QUOZEN_PREFIX, SETTINGS_FILE_NAME, REQUIRED_SHEETS, MemberInput } from "../types";
import { SheetDataMapper } from "./SheetDataMapper";
import { LedgerRepository } from "./LedgerRepository";
import { ValidationService, ValidationStatus } from "../schema/ValidationService";

export class GroupRepository {
    constructor(private storage: IStorageLayer, private user: User, private getToken?: () => string | null) { }

    async getSettings(): Promise<UserSettings> {
        const files = await this.storage.listFiles(`name = '${SETTINGS_FILE_NAME}' and trashed = false`);
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
                if (data && data.version) return data as UserSettings;
            } catch (e) {
                // Fall through to reconcile
            }
        }
        return this.reconcileGroups();
    }

    async saveSettings(settings: UserSettings): Promise<void> {
        settings.lastUpdated = new Date().toISOString();
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
    }

    async reconcileGroups(): Promise<UserSettings> {
        const files = await this.storage.listFiles(`properties has { key='quozen_type' and value='group' } and trashed = false`);
        const visibleGroups: CachedGroup[] = files.map(file => ({
            id: file.id,
            name: file.name.startsWith(QUOZEN_PREFIX) ? file.name.slice(QUOZEN_PREFIX.length) : file.name,
            role: (file.owners?.some((o: any) => o.emailAddress === this.user.email) || file.capabilities?.canDelete) ? "owner" as const : "member" as const,
            lastAccessed: file.createdTime
        })).sort((a, b) => new Date(b.lastAccessed || 0).getTime() - new Date(a.lastAccessed || 0).getTime());

        const settings: UserSettings = {
            version: 1,
            activeGroupId: visibleGroups[0]?.id || null,
            groupCache: visibleGroups,
            preferences: { defaultCurrency: "USD", theme: "system" },
            lastUpdated: new Date().toISOString()
        };
        await this.saveSettings(settings);
        return settings;
    }

    async updateActiveGroup(groupId: string): Promise<void> {
        const settings = await this.getSettings();
        if (settings.activeGroupId === groupId) return;
        
        const validation = await this.validateQuozenSpreadsheet(groupId);
        if (validation.status === ValidationStatus.CORRUPTED || validation.status === ValidationStatus.INCOMPATIBLE) {
             throw new Error("Cannot activate a corrupted group. Please repair it first.");
        }

        settings.activeGroupId = groupId;
        const cached = settings.groupCache.find(g => g.id === groupId);
        if (cached) {
            cached.lastAccessed = new Date().toISOString();
            cached.validationStatus = validation.status;
        }
        await this.saveSettings(settings);
    }

    async create(name: string, members: MemberInput[] = []): Promise<Group> {
        const title = `${QUOZEN_PREFIX}${name}`;
        const fileId = await this.storage.createSpreadsheet(title, [...REQUIRED_SHEETS], { quozen_type: 'group', version: '1.0' });

        const initialMembers = [
            [this.user.id || "unknown", this.user.email, this.user.name, "owner", new Date().toISOString()]
        ];

        for (const member of members) {
            let memberName = member.username || member.email || "Unknown";
            let memberId = member.email || member.username || `user-${(typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString())}`;
            if (member.email) {
                const perm = await this.storage.createPermission(fileId, "writer", "user", member.email);
                if (perm.displayName) memberName = perm.displayName;
                memberId = member.email;
            }
            initialMembers.push([memberId, member.email || "", memberName, "member", new Date().toISOString()]);
        }

        const dataToUpdate = [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt"]] },
            { range: "Members!A2", values: initialMembers }
        ];

        await this.storage.batchUpdateValues(fileId, dataToUpdate);

        const settings = await this.getSettings();
        if (!settings.groupCache.some(g => g.id === fileId)) {
            settings.groupCache.unshift({ id: fileId, name, role: "owner", lastAccessed: new Date().toISOString() });
        }
        settings.activeGroupId = fileId;
        await this.saveSettings(settings);

        return {
            id: fileId, name, description: "Google Sheet Group",
            createdBy: "me",
            participants: initialMembers.map(m => m[0]),
            createdAt: new Date(),
            isOwner: true
        };
    }

    async setGroupPermissions(groupId: string, access: 'public' | 'restricted'): Promise<void> {
        if (access === 'public') {
            await this.storage.createPermission(groupId, "writer", "anyone");
        } else {
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
            if (this.getToken) {
                try {
                    const validationSvc = new ValidationService(this.getToken);
                    const health = await validationSvc.checkHealth(spreadsheetId);
                    status = health.status;
                } catch (e) {
                    console.warn("ValidationService check failed", e);
                }
            }

            if (status === ValidationStatus.CORRUPTED || status === ValidationStatus.INCOMPATIBLE) {
                 // Do not return early so we can try to extract members
            }

            const res = await this.storage.batchGetValues(spreadsheetId, ["Members!A2:Z"]);
            const memberRows = res[0]?.values || [];
            const members = memberRows.map((r: any[], i: number) => SheetDataMapper.mapToMember(r, i + 2).entity);

            return { valid: status !== ValidationStatus.CORRUPTED && status !== ValidationStatus.INCOMPATIBLE, status, name: meta.name || sheetMeta.properties?.title, members };
        } catch (e: any) {
            return { valid: false, status: ValidationStatus.CORRUPTED, error: e.message };
        }
    }

    async importGroup(spreadsheetId: string): Promise<Group> {
        const meta = await this.storage.getFile(spreadsheetId, { fields: "name,properties" });
        if (meta.properties?.quozen_type !== 'group') {
            const validation = await this.validateQuozenSpreadsheet(spreadsheetId);
            if (!validation.valid) throw new Error("Invalid Quozen Group. Missing required sheets.");
            await this.storage.updateFile(spreadsheetId, { properties: { quozen_type: 'group', version: '1.0' } });
        }

        const validation = await this.validateQuozenSpreadsheet(spreadsheetId);

        // We no longer throw an error here. We want to import it as a corrupted group.
        // if (!validation.valid && validation.status === ValidationStatus.OUT_OF_SYNC) {
        //     throw new Error(validation.error || "Invalid group file: Out of sync");
        // }
        // If it's valid but missing version info, auto-initialize
        if (validation.valid && validation.status === ValidationStatus.READY && this.getToken) {
            try {
                const metaForInit = await this.storage.getFile(spreadsheetId, { fields: "appProperties" });
                const currentVersion = parseInt(metaForInit.appProperties?.quozen_schema_version || "0", 10);
                if (currentVersion === 0) {
                     const validationSvc = new ValidationService(this.getToken);
                     await validationSvc.initializeFile(spreadsheetId);
                }
            } catch (e) {
                console.warn("Failed to initialize legacy file schema", e);
            }
        }

        let role: "owner" | "member" = "member";
        if (validation.members) {
            const member = validation.members.find(m => m.email === this.user.email || m.userId === this.user.id);
            if (member?.role === "owner") role = "owner";
            
            if (member && member.userId !== this.user.id) {
                const ledgerRepo = new LedgerRepository(this.storage, spreadsheetId);
                await ledgerRepo.migrateUser(member.userId, this.user.id, this.user.name);
            }
        }

        const settings = await this.getSettings();
        const groupName = validation.name || "Imported Group";
        const cleanName = groupName.startsWith(QUOZEN_PREFIX) ? groupName.slice(QUOZEN_PREFIX.length) : groupName;

        const cachedGroup = settings.groupCache.find(g => g.id === spreadsheetId);
        if (!cachedGroup) {
            settings.groupCache.unshift({ id: spreadsheetId, name: cleanName, role, lastAccessed: new Date().toISOString(), validationStatus: validation.status });
        } else {
            cachedGroup.role = role;
            cachedGroup.lastAccessed = new Date().toISOString();
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
            isOwner: role === "owner"
        };
    }

    async joinGroup(spreadsheetId: string): Promise<Group> {
        const meta = await this.storage.getFile(spreadsheetId, { fields: "name,properties" });
        if (meta.properties?.quozen_type !== 'group') {
            throw new Error("This file is not a valid Quozen Group.");
        }

        const validation = await this.validateQuozenSpreadsheet(spreadsheetId);
        if (!validation.valid) throw new Error("Could not read group data");

        const existingMember = validation.members?.find(m => m.userId === this.user.id || m.email === this.user.email);
        if (!existingMember) {
            const newMember: Member = {
                userId: this.user.id,
                email: this.user.email,
                name: this.user.name,
                role: "member",
                joinedAt: new Date()
            };
            const row = SheetDataMapper.mapFromMember(newMember);
            await this.storage.appendValues(spreadsheetId, "Members!A1", [row]);
        }

        return await this.importGroup(spreadsheetId);
    }

    async deleteGroup(groupId: string): Promise<void> {
        await this.storage.deleteFile(groupId);
        const settings = await this.getSettings();
        settings.groupCache = settings.groupCache.filter(g => g.id !== groupId);
        if (settings.activeGroupId === groupId) settings.activeGroupId = settings.groupCache[0]?.id || null;
        await this.saveSettings(settings);
    }

    async checkMemberHasExpenses(groupId: string, userId: string): Promise<boolean> {
        const ledgerRepo = new LedgerRepository(this.storage, groupId);
        const expenses = await ledgerRepo.getExpenses();
        return expenses.some(e => e.paidByUserId === userId || e.splits.some(s => s.userId === userId && s.amount > 0));
    }

    async updateGroup(groupId: string, name: string, members: MemberInput[]): Promise<void> {
        const newTitle = `${QUOZEN_PREFIX}${name}`;
        await this.storage.updateFile(groupId, { name: newTitle });

        const ledgerRepo = new LedgerRepository(this.storage, groupId);
        const currentMembers = await ledgerRepo.getMembers();

        const processedIds = new Set<string>();
        const desiredMembers = members.map(m => ({ id: m.email || m.username || "", ...m })).filter(m => m.id);

        for (const desired of desiredMembers) {
            const existing = currentMembers.find(c => (desired.email && c.email === desired.email) || (desired.username && c.userId === desired.username));
            if (existing) {
                processedIds.add(existing.userId);
            } else {
                let memberName = desired.username || desired.email || "Unknown";
                let memberId = desired.username || desired.email || `user-${(typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString())}`;
                if (desired.email) {
                    const perm = await this.storage.createPermission(groupId, "writer", "user", desired.email);
                    if (perm?.displayName) memberName = perm.displayName;
                    memberId = desired.email;
                }
                await ledgerRepo.addMember({ userId: memberId, email: desired.email || "", name: memberName, role: "member", joinedAt: new Date() });
                processedIds.add(memberId);
            }
        }

        const membersToDelete = currentMembers.filter(m => !processedIds.has(m.userId) && m.role !== 'owner');
        for (const m of membersToDelete) {
            if (await this.checkMemberHasExpenses(groupId, m.userId)) throw new Error(`Cannot remove ${m.name} because they have expenses.`);
            await ledgerRepo.deleteMember(m.userId);
        }

        const settings = await this.getSettings();
        const cachedGroup = settings.groupCache.find(g => g.id === groupId);
        if (cachedGroup && cachedGroup.name !== name) {
            cachedGroup.name = name;
            await this.saveSettings(settings);
        }
    }

    async leaveGroup(groupId: string): Promise<void> {
        const ledgerRepo = new LedgerRepository(this.storage, groupId);
        const currentMembers = await ledgerRepo.getMembers();
        const member = currentMembers.find(m => m.userId === this.user.id || (this.user.email && m.email === this.user.email));

        if (!member) throw new Error("Member not found");
        if (member.role === 'owner') throw new Error("Owners cannot leave.");
        if (await this.checkMemberHasExpenses(groupId, member.userId)) throw new Error("Cannot leave with expenses.");

        await ledgerRepo.deleteMember(member.userId);
        await this.deleteGroup(groupId); // In the member context, removing from cache operates identically
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
