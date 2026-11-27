import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroupRepository } from '../../src/infrastructure/GroupRepository';
import { InMemoryAdapter } from '../../src/storage/memory-adapter';
import { User } from '../../src/domain/models';
import { QUOZEN_PREFIX } from '../../src/types';
import { QuozenSchema } from '../../src/schema/SchemaDefinition';
import { SchemaEngine, ValidationStatus } from '@qozara/cloud-sync';
import { GoogleSheetsContainerDriver } from '@qozara/cloud-sync-google';
import { UnmanagedDocumentError, ForeignDocumentError } from '../../src/errors';

describe('GroupRepository (Metadata & Sharing Rules)', () => {
    let adapter: InMemoryAdapter;
    let repo: GroupRepository;
    const user: User = {
        id: 'u1',
        name: 'Test User',
        email: 'test@example.com',
        username: 'test'
    };

    beforeEach(() => {
        adapter = new InMemoryAdapter();
        repo = new GroupRepository(adapter as any, user);
    });

    it('creates new group conforming to latest QuozenSchema v3 without corruption during cloud sync', async () => {
        const group = await repo.create("New v3 Group");

        // 1. Verify sheets created
        const sheetMeta = await adapter.getSpreadsheet(group.id);
        const titles = sheetMeta.sheets.map((s: any) => s.properties.title);
        expect(titles).toContain("_migrations");
        expect(titles).toContain("Categories");
        expect(titles).toContain("_meta");

        // 2. Verify _migrations tab contains latest version
        const migRes = await adapter.batchGetValues(group.id, ["_migrations!A1:B2"]);
        const migRows = migRes[0]?.values || [];
        expect(migRows[0]).toEqual(["version", "migrated_at"]);
        expect(Number(migRows[1]?.[0])).toBe(QuozenSchema.version);

        // 3. Verify Categories header contains all QuozenSchema columns including localized fields and deletedAt
        const catRes = await adapter.batchGetValues(group.id, ["Categories!1:1"]);
        const catHeader = catRes[0]?.values?.[0] || [];
        expect(catHeader).toEqual([
            "id",
            "name",
            "name_es",
            "icon",
            "description",
            "description_es",
            "updatedAt",
            "deletedAt"
        ]);

        // 4. Verify checkHealth with SchemaEngine confirms READY (NOT CORRUPTED)
        const bridgeClient = {
            getFileMetadata: async (id: string) => adapter.getFile(id),
            getSpreadsheetMetadata: async (id: string) => adapter.getSpreadsheet(id),
            batchGet: async (id: string, ranges: string[]) => ({ valueRanges: await adapter.batchGetValues(id, ranges) })
        };
        const engine = new SchemaEngine(new GoogleSheetsContainerDriver(bridgeClient as any));
        const health = await engine.checkHealth(group.id, QuozenSchema);
        expect(health.status).toBe(ValidationStatus.READY);
        expect(health.missingColumns).toEqual({});
        expect(health.missingTabs).toEqual([]);
    });

    it('demonstrates that missing deletedAt in Categories causes SchemaEngine to detect CORRUPTED', async () => {
        // Create corrupted sheet mimicking latest group format with v3 migration but old categories header
        const fileId = await adapter.createSpreadsheet("Corrupted Group", ["Expenses", "Settlements", "Members", "Categories", "_migrations", "_meta"]);
        await adapter.batchUpdateValues(fileId, [
            { range: "Expenses!A1", values: [["id", "date", "description", "amount", "paidBy", "category", "splits", "meta"]] },
            { range: "Settlements!A1", values: [["id", "date", "fromUserId", "toUserId", "amount", "method", "notes"]] },
            { range: "Members!A1", values: [["userId", "email", "name", "role", "joinedAt"]] },
            { range: "Categories!A1", values: [["id", "name", "name_es", "icon", "description", "description_es", "updatedAt"]] }, // missing deletedAt!
            { range: "_migrations!A1:B2", values: [["version", "migrated_at"], [QuozenSchema.version, new Date().toISOString()]] },
            { range: "_meta!A1", values: [["key", "value", "updatedAt"]] }
        ]);

        const bridgeClient = {
            getFileMetadata: async (id: string) => adapter.getFile(id),
            getSpreadsheetMetadata: async (id: string) => adapter.getSpreadsheet(id),
            batchGet: async (id: string, ranges: string[]) => ({ valueRanges: await adapter.batchGetValues(id, ranges) })
        };
        const engine = new SchemaEngine(new GoogleSheetsContainerDriver(bridgeClient as any));
        const health = await engine.checkHealth(fileId, QuozenSchema);
        expect(health.status).toBe(ValidationStatus.CORRUPTED);
        expect(health.missingColumns).toEqual({ Categories: ["deletedAt"] });
    });

    it('US-201: Creates group with metadata stamp', async () => {
        const group = await repo.create("New Group");

        const meta = await adapter.getFile(group.id);
        expect(meta.properties).toBeDefined();
        expect(meta.properties?.['quozen_type']).toBe('group');
        expect(meta.properties?.['version']).toBe('1.0');
    });

    it('US-202: Strict Reconciliation ignores files without metadata', async () => {
        // 1. Create a valid group via repo (Stamps it)
        const validGroup = await repo.create("Valid Group");

        // 2. Create a legacy/corrupt file via adapter directly (No Stamp)
        await adapter.createFile(QUOZEN_PREFIX + "Invalid Group", ["Expenses", "Settlements", "Members"], {}); // missing properties

        // 3. Reconcile
        const settings = await repo.reconcileGroups();

        // 4. Verify only valid group is found
        expect(settings.groupCache).toHaveLength(1);
        expect(settings.groupCache[0].id).toBe(validGroup.id);
        expect(settings.groupCache[0].name).toBe("Valid Group");
    });

    it('US-203: Import heals Drive-copied Quozen files (stripped properties, valid _meta) and assigns correct role', async () => {
        // 1. Create a Drive-copied Quozen file (valid _meta manifest, stripped Drive properties, different origin_container_id)
        const fileId = await adapter.createSpreadsheet(QUOZEN_PREFIX + "Copied Legacy Group", ["Expenses", "Settlements", "Members", "_meta"], {});

        await adapter.batchUpdateValues(fileId, [
            {
                range: "_meta!A1",
                values: [
                    ["key", "value", "updatedAt"],
                    ["app_id", "quozen", new Date().toISOString()],
                    ["doc_type", "group", new Date().toISOString()],
                    ["origin_container_id", "original-group-id", new Date().toISOString()],
                ],
            },
            { range: "Members!A2", values: [[user.id, user.email, user.name, "owner", new Date().toISOString()]] }
        ]);

        // 2. Import it
        const importedGroup = await repo.importGroup(fileId);

        // 3. Verify Drive properties are backfilled and origin_container_id is healed to fileId
        const meta = await adapter.getFile(fileId);
        expect(meta.properties?.['quozen_type']).toBe('group');
        expect(meta.properties?.['qozara_app']).toBe('quozen');
        const healedMeta = await repo.readGroupMetadata(fileId);
        expect(healedMeta.origin_container_id).toBe(fileId);
        expect(importedGroup.name).toBe("Copied Legacy Group");

        // 4. Verify correct role assignment
        expect(importedGroup.isOwner).toBe(true);
        const settings = await repo.getSettings();
        expect(settings.groupCache.find(g => g.id === fileId)?.role).toBe("owner");
    });

    it('US-203: Import hard-rejects unmanaged spreadsheets (even with matching tab names) and leaves zero writes', async () => {
        // Unrelated spreadsheet lacking _meta manifest AND lacking legacy quozen_type property
        const fileId = await adapter.createSpreadsheet("Personal Budget", ["Expenses", "Settlements", "Members"], {});

        await expect(repo.importGroup(fileId))
            .rejects.toThrow(UnmanagedDocumentError);

        const meta = await adapter.getFile(fileId);
        expect(meta.properties?.['quozen_type']).toBeUndefined();
        expect(meta.properties?.['qozara_app']).toBeUndefined();
    });

    it('US-203: Import hard-rejects spreadsheets belonging to another Qozara app (foreign _meta app_id)', async () => {
        const fileId = await adapter.createSpreadsheet("Quomida Daily Logs", ["Daily Logs", "_meta"], {});
        await adapter.batchUpdateValues(fileId, [
            {
                range: "_meta!A1",
                values: [
                    ["key", "value", "updatedAt"],
                    ["app_id", "quomida", new Date().toISOString()],
                    ["doc_type", "daily_logs", new Date().toISOString()],
                ],
            },
        ]);

        await expect(repo.importGroup(fileId))
            .rejects.toThrow(ForeignDocumentError);

        const meta = await adapter.getFile(fileId);
        expect(meta.properties?.['quozen_type']).toBeUndefined();
    });

    it('US-204: Join Guard prevents joining non-Quozen files', async () => {
        // 1. Create a random file (No metadata)
        const fileId = await adapter.createSpreadsheet("Random File", ["Sheet1"], {});

        // 2. Attempt Join
        await expect(repo.joinGroup(fileId))
            .rejects.toThrow(UnmanagedDocumentError);
    });

    it('US-204: Join succeeds for valid stamped files', async () => {
        // 1. Create valid group (stamped)
        const group = await repo.create("Public Group");

        // 2. Simulate another user joining
        const user2: User = { id: 'u2', name: 'Joiner', email: 'joiner@example.com', username: 'joiner' };
        const repo2 = new GroupRepository(adapter as any, user2);

        // 3. Join
        const joinedGroup = await repo2.joinGroup(group.id);
        expect(joinedGroup.id).toBe(group.id);

        // 4. Verify member added
        const res = await adapter.batchGetValues(group.id, ["Members!A2:Z"]);
        const rows = res[0]?.values || [];

        // Should have 2 members (the creator 'u1' and the joiner 'u2')
        expect(rows).toHaveLength(2);
        const joinerRow = rows.find((r: any[]) => r[0] === 'u2');
        expect(joinerRow).toBeDefined();
    });

    it('US-205: Joined users retain explicit Drive permissions when group is changed from public to restricted', async () => {
        // 1. User A creates group and makes it public
        const group = await repo.create("Shared Vacation");
        await repo.setGroupPermissions(group.id, "public");
        expect(await repo.getGroupPermissions(group.id)).toBe("public");

        // 2. User B joins via magic link
        const userB: User = { id: 'u-b', name: 'Bob', email: 'bob@example.com', username: 'bob' };
        const repoB = new GroupRepository(adapter as any, userB);
        await repoB.joinGroup(group.id);

        // Verify Bob got an explicit permission on the file
        let perms = await adapter.listPermissions(group.id);
        const bobPerm = perms.find((p: any) => p.emailAddress === 'bob@example.com' && p.role === 'writer');
        expect(bobPerm).toBeDefined();

        // 3. User A toggles the link to restricted
        await repo.setGroupPermissions(group.id, "restricted");
        expect(await repo.getGroupPermissions(group.id)).toBe("restricted");

        // Verify anyone permission is removed but Bob's explicit user permission remains intact
        perms = await adapter.listPermissions(group.id);
        const anyonePerm = perms.find((p: any) => p.type === 'anyone');
        expect(anyonePerm).toBeUndefined();

        const bobPermAfter = perms.find((p: any) => p.emailAddress === 'bob@example.com' && p.role === 'writer');
        expect(bobPermAfter).toBeDefined();
    });

    it('US-206: saveSettings passes activeGroupId to onMutation callback', async () => {
        let notifiedGroupId: string | undefined = "not-called";
        const repoWithMutation = new GroupRepository(
            adapter as any,
            user,
            undefined,
            { name: "testdb", user_settings: { upsert: vi.fn() } } as any,
            undefined,
            (groupId?: string) => {
                notifiedGroupId = groupId;
            }
        );

        await repoWithMutation.saveSettings({
            version: 1,
            activeGroupId: "group-xyz",
            groupCache: [],
            preferences: { defaultCurrency: "USD" },
            lastUpdated: new Date().toISOString()
        });

        expect(notifiedGroupId).toBe("group-xyz");
    });
});
