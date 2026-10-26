import { describe, it, expect, beforeEach } from "vitest";
import { GroupRepository } from "../../src/infrastructure/GroupRepository";
import { InMemoryAdapter } from "../../src/storage/memory-adapter";
import { User } from "../../src/domain/models";
import { GroupFileUnavailableError } from "../../src/errors";
import { LedgerRepository } from "../../src/infrastructure/LedgerRepository";
import { LedgerService } from "../../src/finance/LedgerService";
import { userSettingsMigrationStrategies, userSettingsSchema } from "../../src/db/schemas";

describe("Group Archive & Unarchive (Issue #25)", () => {
    let adapter: InMemoryAdapter;
    let repo: GroupRepository;
    const user: User = {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
        username: "test"
    };

    beforeEach(() => {
        adapter = new InMemoryAdapter();
        repo = new GroupRepository(adapter as any, user);
    });

    describe("RxDB User Settings Schema Evolution (v1 -> v2)", () => {
        it("userSettingsSchema is bumped to version 2 with archivedGroupCache", () => {
            expect(userSettingsSchema.version).toBe(2);
            expect(userSettingsSchema.properties.archivedGroupCache).toBeDefined();
        });

        it("migrates a v1 document to v2 by initializing archivedGroupCache", () => {
            const v1Doc = {
                id: "global_settings",
                version: 1,
                activeGroupId: "g1",
                groupCache: [{ id: "g1", name: "Group 1", role: "owner" }],
                preferences: { defaultCurrency: "USD" },
                preferencesUpdatedAt: "2026-03-01T00:00:00.000Z",
                lastUpdated: "2026-03-01T00:00:00.000Z",
                updatedAt: "2026-03-01T00:00:00.000Z",
                deletedAt: null
            };

            const strategy2 = (userSettingsMigrationStrategies as any)[2];
            expect(typeof strategy2).toBe("function");

            const v2Doc = strategy2(v1Doc);
            expect(v2Doc.version).toBe(2);
            expect(v2Doc.archivedGroupCache).toEqual([]);
            expect(v2Doc.groupCache).toEqual(v1Doc.groupCache);
            expect(v2Doc.preferencesUpdatedAt).toBe(v1Doc.preferencesUpdatedAt);
        });

        it("chains v0 -> v1 -> v2 migrations safely without losing data", () => {
            const v0Doc = {
                id: "global_settings",
                version: 0,
                activeGroupId: "g0",
                groupCache: [{ id: "g0", name: "Legacy Group", role: "owner" }],
                preferences: { defaultCurrency: "EUR" },
                lastUpdated: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                deletedAt: null
            };

            const strategy1 = (userSettingsMigrationStrategies as any)[1];
            const strategy2 = (userSettingsMigrationStrategies as any)[2];

            const v1Doc = strategy1(v0Doc);
            expect(v1Doc.version).toBe(1);
            expect(v1Doc.preferencesUpdatedAt).toBeDefined();

            const v2Doc = strategy2(v1Doc);
            expect(v2Doc.version).toBe(2);
            expect(v2Doc.archivedGroupCache).toEqual([]);
            expect(v2Doc.groupCache[0].name).toBe("Legacy Group");
        });
    });

    describe("Archiving & Unarchiving Groups", () => {
        it("archives an active group, moving it to archivedGroupCache and switching activeGroupId", async () => {
            const g1 = await repo.create("Active Trip 1");
            const g2 = await repo.create("Active Trip 2");

            expect((await repo.getSettings()).activeGroupId).toBe(g2.id);

            await repo.archiveGroup(g2.id);

            const settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === g2.id)).toBe(false);
            expect(settings.archivedGroupCache?.some(g => g.id === g2.id)).toBe(true);
            expect(settings.activeGroupId).toBe(g1.id);
        });

        it("allows owners and members with recorded expenses to archive freely without domain errors", async () => {
            const group = await repo.create("Family Budget");

            // Add an expense paid by this user
            const ledgerRepo = new LedgerRepository(adapter as any, group.id);
            await ledgerRepo.addExpense({
                description: "Groceries",
                amount: 100,
                category: "food_dining",
                date: new Date().toISOString(),
                paidByUserId: user.id,
                splits: [{ userId: user.id, amount: 100 }]
            });

            // leaveGroup would normally throw "Cannot leave with expenses" or "Owners cannot leave"
            // But archiveGroup must succeed without domain blocks
            await expect(repo.archiveGroup(group.id)).resolves.not.toThrow();

            const settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === group.id)).toBe(false);
            expect(settings.archivedGroupCache?.some(g => g.id === group.id)).toBe(true);
        });

        it("unarchives a group, moving it back to groupCache and activating it", async () => {
            const g1 = await repo.create("Trip 1");
            const g2 = await repo.create("Trip 2");

            await repo.archiveGroup(g1.id);

            let settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === g1.id)).toBe(false);
            expect(settings.archivedGroupCache?.some(g => g.id === g1.id)).toBe(true);

            await repo.unarchiveGroup(g1.id);

            settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === g1.id)).toBe(true);
            expect(settings.archivedGroupCache?.some(g => g.id === g1.id)).toBe(false);
            expect(settings.activeGroupId).toBe(g1.id);
        });

        it("unarchives an archived group automatically when imported via Google Picker (importGroup)", async () => {
            const group = await repo.create("Ski Trip");
            await repo.archiveGroup(group.id);

            let settings = await repo.getSettings();
            expect(settings.archivedGroupCache?.some(g => g.id === group.id)).toBe(true);

            await repo.importGroup(group.id);

            settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === group.id)).toBe(true);
            expect(settings.archivedGroupCache?.some(g => g.id === group.id)).toBe(false);
            expect(settings.activeGroupId).toBe(group.id);
        });

        it("reconcileGroups (Drive Scan) ignores archived groups so they do not reappear in active list", async () => {
            const g1 = await repo.create("Vacation A");
            const g2 = await repo.create("Vacation B");

            await repo.archiveGroup(g1.id);

            // Reconcile / Scan Google Drive
            const reconciledSettings = await repo.reconcileGroups();

            expect(reconciledSettings.groupCache.some(g => g.id === g1.id)).toBe(false);
            expect(reconciledSettings.groupCache.some(g => g.id === g2.id)).toBe(true);
            expect(reconciledSettings.archivedGroupCache?.some(g => g.id === g1.id)).toBe(true);
        });
    });

    describe("Read-Only Enforcement for Archived Groups", () => {
        it("blocks write mutations on an archived group via LedgerRepository / LedgerService", async () => {
            const group = await repo.create("Archived Archive");
            await repo.archiveGroup(group.id);

            const ledgerService = new LedgerService(
                new LedgerRepository(adapter as any, group.id),
                user,
                undefined,
                group.id,
                undefined,
                undefined,
                async () => (await repo.getSettings()).archivedGroupCache?.some(g => g.id === group.id) ?? false
            );

            await expect(
                ledgerService.addExpense({
                    description: "Coffee",
                    amount: 5,
                    category: "food_dining",
                    date: new Date().toISOString(),
                    paidByUserId: user.id,
                    splits: [{ userId: user.id, amount: 5 }]
                })
            ).rejects.toThrow(/archived/i);
        });
    });

    describe("Trashed / Deleted File Detection & Auto-Pruning", () => {
        it("prunes active group and throws GroupFileUnavailableError when activating a trashed group", async () => {
            const group = await repo.create("Soon Trashed");
            const g2 = await repo.create("Remaining Group");

            // Mark spreadsheet as trashed in adapter
            adapter.trashFile(group.id);

            await expect(repo.updateActiveGroup(group.id)).rejects.toThrow(GroupFileUnavailableError);

            const settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === group.id)).toBe(false);
            expect(settings.activeGroupId).toBe(g2.id);
        });

        it("prunes active group and throws GroupFileUnavailableError when archiving a trashed group", async () => {
            const group = await repo.create("Trash Me");
            adapter.trashFile(group.id);

            await expect(repo.archiveGroup(group.id)).rejects.toThrow(GroupFileUnavailableError);

            const settings = await repo.getSettings();
            expect(settings.groupCache.some(g => g.id === group.id)).toBe(false);
            expect(settings.archivedGroupCache?.some(g => g.id === group.id)).toBe(false);
        });

        it("prunes archived group and throws GroupFileUnavailableError when unarchiving a trashed/deleted group", async () => {
            const group = await repo.create("Archive First");
            await repo.archiveGroup(group.id);

            // Now delete/trash file in Drive
            await adapter.deleteFile(group.id);

            await expect(repo.unarchiveGroup(group.id)).rejects.toThrow(GroupFileUnavailableError);

            const settings = await repo.getSettings();
            expect(settings.archivedGroupCache?.some(g => g.id === group.id)).toBe(false);
            expect(settings.groupCache.some(g => g.id === group.id)).toBe(false);
        });
    });
});
