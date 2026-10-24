import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    OfflineOperationError,
    createQuozenDatabase,
    destroyQuozenDatabase,
    QuozenDatabase,
    LedgerRepository,
    GroupRepository,
    ReplicationCoordinator,
    CompositeCloudSyncProvider,
    Ledger,
    InMemoryAdapter,
    ValidationStatus
} from "../src/index";

describe("Phase 1, 2, 3: Offline Group Operations, Hydration Tracking & Fast Switching", () => {
    let originalNavigator: any;

    beforeEach(() => {
        originalNavigator = (globalThis as any).navigator;
    });

    afterEach(() => {
        Object.defineProperty(globalThis, "navigator", {
            value: originalNavigator,
            configurable: true,
            writable: true
        });
        vi.restoreAllMocks();
    });

    function setOnline(online: boolean) {
        Object.defineProperty(globalThis, "navigator", {
            value: { onLine: online },
            configurable: true,
            writable: true
        });
    }

    describe("1. OfflineOperationError", () => {
        it("instantiates OfflineOperationError with message and action", () => {
            const err = new OfflineOperationError("Internet connection required", "createGroup");
            expect(err).toBeInstanceOf(Error);
            expect(err).toBeInstanceOf(OfflineOperationError);
            expect(err.name).toBe("OfflineOperationError");
            expect(err.action).toBe("createGroup");
            expect(err.message).toBe("Internet connection required");
        });

        it("provides default message if none is given", () => {
            const err = new OfflineOperationError();
            expect(err.message).toBe("This operation requires an internet connection.");
            expect(err.action).toBeUndefined();
        });
    });

    describe("2. Offline Guards on GroupRepository Cloud Methods", () => {
        let storage: InMemoryAdapter;
        let db: QuozenDatabase;
        let groupRepo: GroupRepository;

        beforeEach(async () => {
            storage = new InMemoryAdapter();
            db = await createQuozenDatabase({ name: `test_offline_guards_${Date.now()}_${Math.random().toString(36).slice(2)}` });
            groupRepo = new GroupRepository(
                storage,
                { id: "u-owner", email: "owner@example.com", name: "Owner", username: "owner" },
                undefined,
                db
            );
        });

        afterEach(async () => {
            await destroyQuozenDatabase(db);
        });

        it("throws OfflineOperationError on create when offline", async () => {
            setOnline(false);
            await expect(groupRepo.create("New Offline Group")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.create("New Offline Group");
            } catch (e: any) {
                expect(e.action).toBe("createGroup");
            }
        });

        it("throws OfflineOperationError on deleteGroup when offline", async () => {
            setOnline(false);
            await expect(groupRepo.deleteGroup("g-123")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.deleteGroup("g-123");
            } catch (e: any) {
                expect(e.action).toBe("deleteGroup");
            }
        });

        it("throws OfflineOperationError on leaveGroup when offline", async () => {
            setOnline(false);
            await expect(groupRepo.leaveGroup("g-123")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.leaveGroup("g-123");
            } catch (e: any) {
                expect(e.action).toBe("leaveGroup");
            }
        });

        it("throws OfflineOperationError on importGroup when offline", async () => {
            setOnline(false);
            await expect(groupRepo.importGroup("g-123")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.importGroup("g-123");
            } catch (e: any) {
                expect(e.action).toBe("importGroup");
            }
        });

        it("throws OfflineOperationError on joinGroup when offline", async () => {
            setOnline(false);
            await expect(groupRepo.joinGroup("g-123")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.joinGroup("g-123");
            } catch (e: any) {
                expect(e.action).toBe("joinGroup");
            }
        });

        it("throws OfflineOperationError on reconcileGroups when offline", async () => {
            setOnline(false);
            await expect(groupRepo.reconcileGroups()).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.reconcileGroups();
            } catch (e: any) {
                expect(e.action).toBe("reconcileGroups");
            }
        });

        it("throws OfflineOperationError on setGroupPermissions when offline", async () => {
            setOnline(false);
            await expect(groupRepo.setGroupPermissions("g-123", "public")).rejects.toThrow(OfflineOperationError);
            try {
                await groupRepo.setGroupPermissions("g-123", "public");
            } catch (e: any) {
                expect(e.action).toBe("changePermissions");
            }
        });

        it("updateGroup: throws OfflineOperationError when adding a brand new member with email offline", async () => {
            setOnline(true);
            const group = await groupRepo.create("Trip");
            setOnline(false);

            await expect(
                groupRepo.updateGroup(group.id, "Trip", [
                    { username: "alice", email: "alice@example.com" }
                ])
            ).rejects.toThrow(OfflineOperationError);

            try {
                await groupRepo.updateGroup(group.id, "Trip", [
                    { username: "alice", email: "alice@example.com" }
                ]);
            } catch (e: any) {
                expect(e.action).toBe("inviteEmail");
            }
        });

        it("updateGroup: allows adding a member with only username when offline", async () => {
            setOnline(true);
            const group = await groupRepo.create("Trip");
            setOnline(false);

            // Adding a member without email offline should succeed
            await groupRepo.updateGroup(group.id, "Trip", [
                { username: "offline_bob" }
            ]);

            const ledgerRepo = new LedgerRepository(storage, group.id, db);
            const members = await ledgerRepo.getMembers();
            expect(members.some(m => m.userId === "offline_bob" || m.name === "offline_bob")).toBe(true);
        });
    });

    describe("3. Group Renaming & Pending Rename Sync", () => {
        let storage: InMemoryAdapter;
        let db: QuozenDatabase;
        let groupRepo: GroupRepository;

        beforeEach(async () => {
            storage = new InMemoryAdapter();
            db = await createQuozenDatabase({ name: `test_rename_${Date.now()}_${Math.random().toString(36).slice(2)}` });
            groupRepo = new GroupRepository(
                storage,
                { id: "u-owner", email: "owner@example.com", name: "Owner", username: "owner" },
                undefined,
                db
            );
        });

        afterEach(async () => {
            await destroyQuozenDatabase(db);
        });

        it("marks pendingRename: true in groupCache when renaming group offline", async () => {
            setOnline(true);
            const group = await groupRepo.create("Original Name");

            setOnline(false);
            await groupRepo.updateGroup(group.id, "Renamed Offline", []);

            const settings = await groupRepo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.name).toBe("Renamed Offline");
            expect(cached?.pendingRename).toBe(true);
        });

        it("CompositeCloudSyncProvider syncs pending group rename when pushing user_settings back online", async () => {
            setOnline(true);
            const group = await groupRepo.create("Initial Name");

            setOnline(false);
            await groupRepo.updateGroup(group.id, "Offline Renamed Group", []);

            const settings = await groupRepo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id);
            expect(cached?.pendingRename).toBe(true);

            // Set online and push user_settings
            setOnline(true);
            const updateFileSpy = vi.spyOn(storage, "updateFile");

            const provider = new CompositeCloudSyncProvider({
                blobDriver: {
                    readBlob: vi.fn().mockResolvedValue(null),
                    writeBlob: vi.fn().mockResolvedValue(undefined)
                },
                tabularDriver: {
                    storageLayer: storage,
                    readTable: vi.fn().mockResolvedValue([]),
                    writeTable: vi.fn().mockResolvedValue(undefined)
                } as any
            });
            await provider.initialize();

            await provider.push({
                collection: "user_settings",
                documents: [settings]
            });

            expect(updateFileSpy).toHaveBeenCalledWith(group.id, { name: "Quozen - Offline Renamed Group" });
            expect(cached?.pendingRename).toBe(false);
        });
    });

    describe("4. Fast Active Group Switching", () => {
        let storage: InMemoryAdapter;
        let db: QuozenDatabase;
        let groupRepo: GroupRepository;

        beforeEach(async () => {
            storage = new InMemoryAdapter();
            db = await createQuozenDatabase({ name: `test_switching_${Date.now()}_${Math.random().toString(36).slice(2)}` });
            groupRepo = new GroupRepository(
                storage,
                { id: "u-owner", email: "owner@example.com", name: "Owner", username: "owner" },
                undefined,
                db
            );
        });

        afterEach(async () => {
            await destroyQuozenDatabase(db);
        });

        it("switches active group immediately without blocking on validateQuozenSpreadsheet when db is present", async () => {
            setOnline(true);
            const g1 = await groupRepo.create("Group 1");
            const g2 = await groupRepo.create("Group 2");

            const validateSpy = vi.spyOn(groupRepo as any, "validateQuozenSpreadsheet");

            await groupRepo.updateActiveGroup(g1.id);
            const settings = await groupRepo.getSettings();
            expect(settings.activeGroupId).toBe(g1.id);

            // With db present, updateActiveGroup must NOT block on validateQuozenSpreadsheet!
            expect(validateSpy).not.toHaveBeenCalled();
        });

        it("prevents activating a corrupted group when db is present", async () => {
            setOnline(true);
            const group = await groupRepo.create("Healthy Group");

            const settings = await groupRepo.getSettings();
            const cached = settings.groupCache.find(g => g.id === group.id)!;
            cached.validationStatus = ValidationStatus.CORRUPTED;
            await groupRepo.saveSettings(settings);

            // Switch to null first
            settings.activeGroupId = null;
            await groupRepo.saveSettings(settings);

            await expect(groupRepo.updateActiveGroup(group.id)).rejects.toThrow("Cannot activate a corrupted group");
        });
    });

    describe("5. Group Hydration Tracking & Resilience", () => {
        let storage: InMemoryAdapter;
        let db: QuozenDatabase;

        beforeEach(async () => {
            storage = new InMemoryAdapter();
            db = await createQuozenDatabase({ name: `test_hydration_${Date.now()}_${Math.random().toString(36).slice(2)}` });
        });

        afterEach(async () => {
            await destroyQuozenDatabase(db);
        });

        it("tracks hydrated groups statically in ReplicationCoordinator", () => {
            expect(ReplicationCoordinator.isGroupHydrated(db.name, "group-1")).toBe(false);
            ReplicationCoordinator.markGroupHydrated(db.name, "group-1");
            expect(ReplicationCoordinator.isGroupHydrated(db.name, "group-1")).toBe(true);
        });

        it("hydrates expenses and settlements even if members were already populated in RxDB", async () => {
            const groupId = await storage.createSpreadsheet("Quozen - Hydration Test", [
                "Expenses",
                "Settlements",
                "Members",
                "Categories",
                "_migrations"
            ]);

            await storage.batchUpdateValues(groupId, [
                {
                    range: "Expenses!A1:H2",
                    values: [
                        ["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"],
                        ["exp-remote-1", "2026-03-01T12:00:00.000Z", "Dinner", "50", "u1", "Food", JSON.stringify([{ userId: "u1", amount: 50 }]), JSON.stringify({ createdAt: "2026-03-01T12:00:00.000Z" })]
                    ]
                },
                {
                    range: "Settlements!A1:G2",
                    values: [
                        ["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"],
                        ["set-remote-1", "2026-03-01T13:00:00.000Z", "u2", "u1", "25", "cash", "half"]
                    ]
                },
                {
                    range: "Members!A1:F2",
                    values: [
                        ["userId", "email", "name", "role", "joinedAt", "updatedAt"],
                        ["u1", "u1@example.com", "User 1", "owner", "2026-03-01T10:00:00.000Z", "2026-03-01T10:00:00.000Z"]
                    ]
                }
            ]);

            // Simulate partial population (e.g. from importGroup or joinGroup where members were added locally)
            await db.members.insert({
                id: `${groupId}_u1`,
                groupId,
                userId: "u1",
                email: "u1@example.com",
                name: "User 1",
                role: "owner",
                joinedAt: "2026-03-01T10:00:00.000Z",
                updatedAt: "2026-03-01T10:00:00.000Z"
            });

            // Even though db.members has 1 member, group is NOT marked hydrated and has 0 transactions!
            const ledgerRepo = new LedgerRepository(storage, groupId, db);
            const expenses = await ledgerRepo.getExpenses();
            expect(expenses.length).toBe(1);
            expect(expenses[0].id).toBe("exp-remote-1");

            const settlements = await ledgerRepo.getSettlements();
            expect(settlements.length).toBe(1);
            expect(settlements[0].id).toBe("set-remote-1");

            expect(await ledgerRepo.isGroupHydrated()).toBe(true);
        });

        it("cleans up hydrationPromises on error so subsequent call retries hydration", async () => {
            const groupId = "failing-group-id";
            let callCount = 0;

            const failingStorage = {
                batchGetValues: vi.fn().mockImplementation(async () => {
                    callCount++;
                    if (callCount === 1) {
                        throw new Error("Network offline during initial hydration");
                    }
                    return [
                        { values: [["userId", "email", "name", "role", "joinedAt"], ["u1", "u1@example.com", "U1", "owner", "2026-01-01"]] },
                        { values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"], ["exp-1", "2026-01-01", "Coffee", "5", "u1", "Food", "[]", "{}"]] },
                        { values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
                        { values: [] }
                    ];
                })
            } as any;

            const ledgerRepo = new LedgerRepository(failingStorage, groupId, db);

            // First attempt fails
            const expAttempt1 = await ledgerRepo.getExpenses();
            expect(expAttempt1.length).toBe(0);
            expect(ReplicationCoordinator.isGroupHydrated(db.name, groupId)).toBe(false);

            // Second attempt (now recovered) should retry hydration instead of reusing cached failed promise!
            const expAttempt2 = await ledgerRepo.getExpenses();
            expect(expAttempt2.length).toBe(1);
            expect(expAttempt2[0].id).toBe("exp-1");
            expect(ReplicationCoordinator.isGroupHydrated(db.name, groupId)).toBe(true);
        });

        it("Ledger reflects isHydrated property", () => {
            const ledgerHydrated = new Ledger({
                expenses: [],
                settlements: [],
                members: [],
                isHydrated: true
            });
            expect(ledgerHydrated.isHydrated).toBe(true);

            const ledgerUnhydrated = new Ledger({
                expenses: [],
                settlements: [],
                members: [],
                isHydrated: false
            });
            expect(ledgerUnhydrated.isHydrated).toBe(false);

            const ledgerDefault = new Ledger({
                expenses: [],
                settlements: [],
                members: []
            });
            expect(ledgerDefault.isHydrated).toBe(true);
        });
    });
});
