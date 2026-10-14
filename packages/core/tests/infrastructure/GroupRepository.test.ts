import { describe, it, expect, beforeEach } from 'vitest';
import { GroupRepository } from '../../src/infrastructure/GroupRepository';
import { InMemoryAdapter } from '../../src/storage/memory-adapter';
import { User } from '../../src/domain/models';
import { QUOZEN_PREFIX } from '../../src/types';

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

    it('US-203: Import blesses legacy files (Stamps Metadata) and assigns correct role', async () => {
        // 1. Create a legacy file (correct structure, missing metadata)
        const fileId = await adapter.createSpreadsheet(QUOZEN_PREFIX + "Legacy Group", ["Expenses", "Settlements", "Members"], {});

        // Add user to members manually to simulate pre-existing access
        await adapter.batchUpdateValues(fileId, [
            { range: "Members!A2", values: [[user.id, user.email, user.name, "owner", new Date().toISOString()]] }
        ]);

        // 2. Import it
        const importedGroup = await repo.importGroup(fileId);

        // 3. Verify it's stamped
        const meta = await adapter.getFile(fileId);
        expect(meta.properties?.['quozen_type']).toBe('group');
        expect(importedGroup.name).toBe("Legacy Group");

        // 4. Verify correct role assignment
        expect(importedGroup.isOwner).toBe(true);
        const settings = await repo.getSettings();
        expect(settings.groupCache.find(g => g.id === fileId)?.role).toBe("owner");
    });

    it('US-203: Import fails for invalid files (Wrong Structure)', async () => {
        // 1. Create random spreadsheet (Missing sheets)
        const fileId = await adapter.createSpreadsheet("Random Sheet", ["Sheet1"], {});

        // 2. Attempt Import
        await expect(repo.importGroup(fileId))
            .rejects.toThrow(/Missing required sheets/i);

        // 3. Verify NOT stamped
        const meta = await adapter.getFile(fileId);
        expect(meta.properties?.['quozen_type']).toBeUndefined();
    });

    it('US-204: Join Guard prevents joining non-Quozen files', async () => {
        // 1. Create a random file (No metadata)
        const fileId = await adapter.createSpreadsheet("Random File", ["Sheet1"], {});

        // 2. Attempt Join
        await expect(repo.joinGroup(fileId))
            .rejects.toThrow("This file is not a valid Quozen Group.");
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
});
