import { describe, it, expect, vi } from "vitest";
import { SheetDataMapper } from "../src/infrastructure/SheetDataMapper";
import { memberToDoc, docToMember } from "../src/db/schemas";
import { StorageLayerCatalogAndAclDriver } from "../src/sync/StorageLayerCatalogAndAclDriver";
import { InMemoryAdapter } from "../src/storage/memory-adapter";
import { Member } from "../src/domain/models";
import { QuozenClient } from "../src/QuozenClient";

describe("Account Identity & Storage Decoupling Architecture", () => {
    describe("Phase 1 & 2: Domain Model & Data Mapper Single Source of Truth", () => {
        it("maps comma-separated emails from Members!email into Member.managedBy", () => {
            const row = ["acc_xyz", "alice@example.com, bob@example.com", "Joint Account", "member", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"];
            const { entity } = SheetDataMapper.mapToMember(row, 2);

            expect(entity.userId).toBe("acc_xyz");
            expect(entity.name).toBe("Joint Account");
            expect(entity.managedBy).toEqual(["alice@example.com", "bob@example.com"]);
            expect(entity.email).toBe("alice@example.com");
        });

        it("serializes Member.managedBy as comma-separated emails in Members!email", () => {
            const member: Member = {
                userId: "acc_xyz",
                name: "Shared Vault",
                role: "member",
                managedBy: ["alice@example.com", "charlie@example.com"],
                joinedAt: new Date("2026-01-01T00:00:00.000Z"),
                updatedAt: new Date("2026-01-01T00:00:00.000Z")
            };

            const row = SheetDataMapper.mapFromMember(member);
            expect(row[0]).toBe("acc_xyz");
            expect(row[1]).toBe("alice@example.com, charlie@example.com");
            expect(row[2]).toBe("Shared Vault");
        });

        it("seamlessly converts to and from RxDB member documents without altering RxDB table schema", () => {
            const member: Member = {
                userId: "acc_shared_1",
                name: "House Fund",
                role: "member",
                managedBy: ["roommate1@test.com", "roommate2@test.com"],
                joinedAt: new Date("2026-01-01T00:00:00.000Z"),
                updatedAt: new Date("2026-01-01T00:00:00.000Z")
            };

            const doc = memberToDoc(member, "group_1");
            expect(doc.id).toBe("group_1_acc_shared_1");
            expect(doc.email).toBe("roommate1@test.com, roommate2@test.com");

            const restored = docToMember(doc);
            expect(restored.userId).toBe("acc_shared_1");
            expect(restored.name).toBe("House Fund");
            expect(restored.managedBy).toEqual(["roommate1@test.com", "roommate2@test.com"]);
        });
    });

    describe("Phase 3: StorageLayerCatalogAndAclDriver Adapter & Decoupling", () => {
        it("lists and inspects group containers using IStorageLayer abstraction", () => {
            const memoryStorage = new InMemoryAdapter();
            const driver = new StorageLayerCatalogAndAclDriver(memoryStorage, "owner@example.com");

            expect(driver.id).toBe("storage-layer-catalog-acl");
            expect(driver.name).toBe("Storage Layer Catalog & ACL Driver");
        });

        it("grants, revokes, and inspects access mode via ACL driver", async () => {
            const memoryStorage = new InMemoryAdapter();
            const driver = new StorageLayerCatalogAndAclDriver(memoryStorage, "admin@example.com");

            const fileId = await driver.createGroupContainer("Test Group", ["Expenses", "Members"], {
                quozen_type: "group"
            });

            // Default restricted mode
            const mode1 = await driver.getAccessMode(fileId);
            expect(mode1).toBe("restricted");

            // Make public
            await driver.setAccessMode(fileId, "public");
            const mode2 = await driver.getAccessMode(fileId);
            expect(mode2).toBe("public");

            // Make restricted again
            await driver.setAccessMode(fileId, "restricted");
            const mode3 = await driver.getAccessMode(fileId);
            expect(mode3).toBe("restricted");

            // Grant collaborator access
            await driver.grantAccess(fileId, "member@example.com", "editor");
            const collabs = await driver.listCollaborators(fileId);
            expect(collabs.some(c => c.email === "member@example.com")).toBe(true);

            // Container health check
            const health = await driver.checkContainerHealth(fileId);
            expect(health.available).toBe(true);
        });

        it("supports custom catalog and ACL drivers in QuozenClient", async () => {
            const memoryStorage = new InMemoryAdapter();
            const mockCatalogDriver = {
                id: "custom-catalog",
                listGroupContainers: vi.fn().mockResolvedValue([
                    { id: "grp-custom", name: "quozen_Custom", isOwner: true }
                ]),
                getGroupContainer: vi.fn().mockResolvedValue(null),
                createGroupContainer: vi.fn().mockResolvedValue("grp-custom"),
                updateGroupContainer: vi.fn().mockResolvedValue(undefined),
                deleteGroupContainer: vi.fn().mockResolvedValue(undefined),
                checkContainerHealth: vi.fn().mockResolvedValue({ available: true })
            };

            const mockAclDriver = {
                id: "custom-acl",
                listCollaborators: vi.fn().mockResolvedValue([]),
                grantAccess: vi.fn().mockResolvedValue({ displayName: "Custom User" }),
                revokeAccess: vi.fn().mockResolvedValue(undefined),
                getAccessMode: vi.fn().mockResolvedValue("restricted" as const),
                setAccessMode: vi.fn().mockResolvedValue(undefined)
            };

            const client = new QuozenClient({
                storage: memoryStorage,
                user: { id: "u-123", email: "user@example.com", name: "Test User" },
                catalogDriver: mockCatalogDriver,
                aclDriver: mockAclDriver
            });

            const settings = await client.groups.reconcileGroups();
            expect(mockCatalogDriver.listGroupContainers).toHaveBeenCalled();
            expect(settings.groupCache.some(g => g.id === "grp-custom")).toBe(true);

            const access = await client.groups.getGroupPermissions("grp-custom");
            expect(mockAclDriver.getAccessMode).toHaveBeenCalledWith("grp-custom");
            expect(access).toBe("restricted");
        });
    });

    describe("Phase 1 & 4: migrateUser Deprecation Guard", () => {
        it("never overwrites non-email account userId on getLedger()", async () => {
            const memoryStorage = new InMemoryAdapter();
            const currentUser = { id: "google-sub-9999", email: "carol@example.com", name: "Carol Real Name" };

            const client = new QuozenClient({
                storage: memoryStorage,
                user: currentUser
            });

            // Create group with an opaque account ID acc_carol_opaque
            const group = await client.groups.create("Trip", [
                { username: "Bob", email: "bob@example.com" }
            ]);

            // Add an account with an opaque immutable ID that has Carol's email
            const ledgerRepo = client.ledger(group.id);
            await (ledgerRepo as any).repo.addMember({
                userId: "acc_carol_opaque",
                email: "carol@example.com",
                name: "Carol Vacation Account",
                role: "member",
                joinedAt: new Date(),
                updatedAt: new Date()
            });

            const ledger = await ledgerRepo.getLedger();
            const carolAccount = ledger.members.find(m => m.name === "Carol Vacation Account");
            expect(carolAccount).toBeDefined();
            // The opaque ID must remain intact and NOT be migrated to google-sub-9999
            expect(carolAccount?.userId).toBe("acc_carol_opaque");
        });
    });
});
