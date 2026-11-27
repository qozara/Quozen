import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    QuozenClient,
    InMemoryAdapter,
    GroupClosedError,
    GroupNotSettledError,
    CommandDraftService,
    userSettingsSchema,
    userSettingsMigrationStrategies,
    mergeUserSettingsDocs,
    createQuozenDatabase,
    type User,
    type QuozenDatabase,
} from "../../src";

describe("Close & Re-open Expense Groups (Core Infrastructure & Services)", () => {
    let adapter: InMemoryAdapter;
    const owner: User = {
        id: "u1",
        username: "alice",
        email: "alice@example.com",
        name: "Alice",
    };
    const member: User = {
        id: "u2",
        username: "bob",
        email: "bob@example.com",
        name: "Bob",
    };
    const outsider: User = {
        id: "u3",
        username: "eve",
        email: "eve@example.com",
        name: "Eve",
    };

    beforeEach(() => {
        adapter = new InMemoryAdapter();
    });

    it("userSettingsSchema v5 includes status, statusUpdatedAt, pendingStatusSync and migrates v4 docs", () => {
        expect(userSettingsSchema.version).toBeGreaterThanOrEqual(5);
        const groupCacheProps = (userSettingsSchema.properties.groupCache as any).items.properties;
        expect(groupCacheProps.status).toBeDefined();
        expect(groupCacheProps.statusUpdatedAt).toBeDefined();
        expect(groupCacheProps.pendingStatusSync).toBeDefined();

        const migrated = userSettingsMigrationStrategies[5]({
            id: "global_settings",
            version: 4,
            activeGroupId: "g1",
            groupCache: [{ id: "g1", name: "Trip", role: "owner" }],
            archivedGroupCache: [],
            preferences: { defaultCurrency: "USD" },
            lastUpdated: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        expect(migrated.version).toBe(5);
        expect(migrated.groupCache[0].status).toBe("open");
    });

    it("allows closing a settled group, persists status to _meta, blocks all CRUD & drafts, and allows re-opening", async () => {
        const ownerClient = new QuozenClient({ storage: adapter as any, user: owner });
        const group = await ownerClient.groups.create("Tokyo Trip", [{ email: member.email, username: member.name }]);

        // Add expense ($100 split 50/50)
        const expense = await ownerClient.ledger(group.id).addExpense({
            description: "Ramen",
            amount: 100,
            category: "food_dining",
            date: new Date("2026-02-01"),
            paidByUserId: owner.id,
        });

        // Closing without force fails with GroupNotSettledError because balances are +50 / -50
        await expect(ownerClient.groups.closeGroup(group.id)).rejects.toThrow(GroupNotSettledError);

        // Settle the $50 debt -> all balances are now 0
        const settlement = await ownerClient.ledger(group.id).addSettlement({
            fromUserId: member.email,
            toUserId: owner.id,
            amount: 50,
            method: "cash",
        });

        // Now closeGroup succeeds without force
        await ownerClient.groups.closeGroup(group.id);

        // Verify _meta tab persisted status = closed
        const meta = await ownerClient.groups.readGroupMetadata(group.id);
        expect(meta.status).toBe("closed");

        // Verify Ledger reflects closed status
        const closedLedger = await ownerClient.ledger(group.id).getLedger();
        expect(closedLedger.status).toBe("closed");
        expect(closedLedger.isClosed).toBe(true);

        // All LedgerService mutations must reject with GroupClosedError
        const ledgerSvc = ownerClient.ledger(group.id);
        await expect(
            ledgerSvc.addExpense({
                description: "Coffee",
                amount: 10,
                category: "food_dining",
                date: new Date(),
                paidByUserId: owner.id,
            })
        ).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.updateExpense(expense.id, { description: "Updated" })).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.deleteExpense(expense.id)).rejects.toThrow(GroupClosedError);
        await expect(
            ledgerSvc.addSettlement({ fromUserId: member.email, toUserId: owner.id, amount: 5, method: "cash" })
        ).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.updateSettlement(settlement.id, { amount: 40 })).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.deleteSettlement(settlement.id)).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.renameMember(owner.id, "Alice New")).rejects.toThrow(GroupClosedError);
        await expect(ledgerSvc.removeUnusedMember(owner.id)).rejects.toThrow(GroupClosedError);

        // Group metadata edit & new member join must reject with GroupClosedError
        await expect(ownerClient.groups.updateGroup(group.id, "Renamed", [])).rejects.toThrow(GroupClosedError);

        // CommandDraftService must reject with GroupClosedError
        const draftSvc = new CommandDraftService();
        await expect(
            draftSvc.createDraft({ input: "dinner 40", ledger: closedLedger, activeAccountId: owner.id })
        ).rejects.toThrow(GroupClosedError);

        // Re-open group -> mutations are accepted again
        await ownerClient.groups.reopenGroup(group.id);
        const reopenedLedger = await ownerClient.ledger(group.id).getLedger();
        expect(reopenedLedger.status).toBe("open");
        expect(reopenedLedger.isClosed).toBe(false);

        const afterReopenExpense = await ownerClient.ledger(group.id).addExpense({
            description: "Souvenirs",
            amount: 20,
            category: "shopping",
            date: new Date(),
            paidByUserId: owner.id,
        });
        expect(afterReopenExpense.id).toBeDefined();
    });

    it("allows any group member (non-owner) to force-close and reopen a group, while rejecting non-members", async () => {
        const ownerClient = new QuozenClient({ storage: adapter as any, user: owner });
        const group = await ownerClient.groups.create("Roadtrip", [{ email: member.email, username: member.name }]);
        await ownerClient.ledger(group.id).addExpense({
            description: "Gas",
            amount: 80,
            category: "transportation",
            date: new Date(),
            paidByUserId: owner.id,
        });

        // Non-member cannot close
        const outsiderClient = new QuozenClient({ storage: adapter as any, user: outsider });
        await expect(outsiderClient.groups.closeGroup(group.id, { force: true })).rejects.toThrow(/Forbidden/i);

        // Regular member can force-close despite non-zero balances
        const memberClient = new QuozenClient({ storage: adapter as any, user: member });
        await memberClient.groups.importGroup(group.id);
        await memberClient.groups.closeGroup(group.id, { force: true });

        // Owner sees closed status from _meta
        expect(await ownerClient.groups.getGroupStatus(group.id)).toBe("closed");

        // Regular member can reopen
        await memberClient.groups.reopenGroup(group.id);
        expect(await ownerClient.groups.getGroupStatus(group.id)).toBe("open");
    });

    describe("Offline-capable close/reopen & LWW UserSettingsMerger", () => {
        let db: QuozenDatabase;
        const originalNavigator = globalThis.navigator;

        afterEach(async () => {
            Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true });
            if (db) {
                await db.close();
            }
        });

        it("marks pendingStatusSync when closed offline with RxDB and merges status via LWW", async () => {
            db = await createQuozenDatabase({ name: `test_close_offline_${Date.now()}` });
            const client = new QuozenClient({ storage: adapter as any, user: owner, db });
            const group = await client.groups.create("Offline Test", []);

            // Go offline
            Object.defineProperty(globalThis, "navigator", {
                value: { onLine: false },
                configurable: true,
            });

            await client.groups.closeGroup(group.id);

            const settings = await client.groups.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.status).toBe("closed");
            expect(cached?.pendingStatusSync).toBe(true);

            // Offline write is immediately blocked
            await expect(
                client.ledger(group.id).addExpense({
                    description: "Blocked offline",
                    amount: 10,
                    category: "other",
                    date: new Date(),
                    paidByUserId: owner.id,
                })
            ).rejects.toThrow(GroupClosedError);

            // UserSettingsMerger preserves newer local status & pendingStatusSync
            const { mergedDoc, shouldPushRemote } = mergeUserSettingsDocs(
                {
                    id: "global_settings",
                    version: 5,
                    activeGroupId: group.id,
                    groupCache: [
                        {
                            id: group.id,
                            name: "Offline Test",
                            role: "owner",
                            status: "closed",
                            statusUpdatedAt: "2026-11-27T12:00:00.000Z",
                            pendingStatusSync: true,
                            updatedAt: "2026-11-27T12:00:00.000Z",
                        },
                    ],
                    archivedGroupCache: [],
                    preferences: { defaultCurrency: "USD" },
                    lastUpdated: "2026-11-27T12:00:00.000Z",
                    updatedAt: "2026-11-27T12:00:00.000Z",
                },
                {
                    id: "global_settings",
                    version: 5,
                    activeGroupId: group.id,
                    groupCache: [
                        {
                            id: group.id,
                            name: "Offline Test",
                            role: "owner",
                            status: "open",
                            statusUpdatedAt: "2026-11-27T11:00:00.000Z",
                            updatedAt: "2026-11-27T11:00:00.000Z",
                        },
                    ],
                    archivedGroupCache: [],
                    preferences: { defaultCurrency: "USD" },
                    lastUpdated: "2026-11-27T11:00:00.000Z",
                    updatedAt: "2026-11-27T11:00:00.000Z",
                }
            );
            expect(shouldPushRemote).toBe(true);
            expect(mergedDoc.groupCache[0].status).toBe("closed");
            expect(mergedDoc.groupCache[0].pendingStatusSync).toBe(true);
        });
    });
});
