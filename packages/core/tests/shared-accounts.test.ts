import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuozenClient, InMemoryAdapter, QuozenAI } from '../src';
import { IStorageLayer } from '../src/infrastructure/IStorageLayer';
import { AiProvider } from '../src/agent/providers/types';

/**
 * Creates a per-user storage view that isolates `quozen-settings.json` per user
 * while sharing all group spreadsheets in `sharedStorage`.
 */
function createPerUserStorage(sharedStorage: InMemoryAdapter): IStorageLayer {
    const privateSettingsStorage = new InMemoryAdapter();
    const privateFileIds = new Set<string>();

    return new Proxy(sharedStorage, {
        get(target, prop, receiver) {
            if (prop === 'createFile') {
                return async (name: string, mimeTypeOrSheetNames: string | string[], properties?: Record<string, string>, content?: string) => {
                    if (name === 'quozen-settings.json') {
                        const id = await privateSettingsStorage.createFile(name, mimeTypeOrSheetNames, properties, content);
                        privateFileIds.add(id);
                        return id;
                    }
                    return target.createFile(name, mimeTypeOrSheetNames, properties, content);
                };
            }
            if (prop === 'listFiles') {
                return async (queryOrOptions?: any, fields?: string) => {
                    if (typeof queryOrOptions === 'string' && queryOrOptions.includes("name = 'quozen-settings.json'")) {
                        return privateSettingsStorage.listFiles(queryOrOptions, fields);
                    }
                    return target.listFiles(queryOrOptions, fields);
                };
            }
            if (prop === 'getFile') {
                return async (fileId: string, options?: any) => {
                    if (privateFileIds.has(fileId)) {
                        return privateSettingsStorage.getFile(fileId, options);
                    }
                    return target.getFile(fileId, options);
                };
            }
            if (prop === 'updateFile') {
                return async (fileId: string, metadata?: any, content?: string) => {
                    if (privateFileIds.has(fileId)) {
                        return privateSettingsStorage.updateFile(fileId, metadata, content);
                    }
                    return target.updateFile(fileId, metadata, content);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

describe('Account-User Separation (Shared, Personal, and Offline Accounts)', () => {
    let sharedStorage: InMemoryAdapter;
    let clientA: QuozenClient;
    let clientB: QuozenClient;
    let clientC: QuozenClient;

    const userA = { id: 'u1', username: 'alice', name: 'Alice', email: 'alice@example.com' };
    const userB = { id: 'u2', username: 'bob', name: 'Bob', email: 'bob@example.com' };
    const userC = { id: 'u3', username: 'charlie', name: 'Charlie', email: 'charlie@example.com' };
    const userD = { id: 'u4', username: 'diana', name: 'Diana', email: 'diana@example.com' };

    let clientD: QuozenClient;

    beforeEach(() => {
        sharedStorage = new InMemoryAdapter();
        clientA = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userA });
        clientB = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userB });
        clientC = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userC });
        clientD = new QuozenClient({ storage: createPerUserStorage(sharedStorage), user: userD });
    });

    it('allows two users (A and B) to co-manage a Shared Account and split 50/50 with User C without schema or row migrations', async () => {
        // 1. User A creates a group with User C (invited by email)
        const group = await clientA.groups.create('Patagonia Trip', [
            { username: 'Charlie', email: userC.email }
        ]);

        // 2. User A renames her account to a Shared Account name: "Garcia Family"
        await clientA.ledger(group.id).renameMember(userA.id, 'Garcia Family');

        // 3. User B joins the group and links directly to the "Garcia Family" Shared Account (u1)
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        // Verify User B's settings store the linked accountId
        const bAccountId = await clientB.groups.getGroupAccountId(group.id);
        expect(bAccountId).toBe(userA.id);

        // Verify loading the ledger as User B does NOT create a duplicate member or migrate u1 -> u2
        const ledgerFromB = await clientB.ledger(group.id).getLedger();
        expect(ledgerFromB.members).toHaveLength(2);
        expect(ledgerFromB.members.find(m => m.userId === userA.id)?.name).toBe('Garcia Family');
        expect(ledgerFromB.members.find(m => m.userId === userB.id)).toBeUndefined();

        // 4. User C joins the group as their own Personal Account (migrates charlie@example.com -> u3)
        await clientC.groups.joinGroup(group.id);
        const ledgerFromC = await clientC.ledger(group.id).getLedger();
        expect(ledgerFromC.members).toHaveLength(2);
        expect(ledgerFromC.members.map(m => m.userId).sort()).toEqual(['u1', 'u3']);

        // 5. User C creates a $100 expense shared equally across the group (between u3 and Shared Account u1)
        await clientC.ledger(group.id).addExpense({
            description: 'Hotel Booking',
            amount: 100,
            paidByUserId: userC.id,
            category: 'Lodging',
            date: new Date('2026-10-10'),
            splits: [
                { userId: userC.id, amount: 50 },
                { userId: userA.id, amount: 50 }
            ]
        });

        // 6. User B (logged in as u2, managing Shared Account u1) creates a $60 expense paid by Shared Account u1
        await clientB.ledger(group.id).addExpense({
            description: 'Groceries',
            amount: 60,
            paidByUserId: userA.id,
            category: 'Food',
            date: new Date('2026-10-11'),
            splits: [
                { userId: userA.id, amount: 30 },
                { userId: userC.id, amount: 30 }
            ]
        });

        // 7. Verify balances across the 2 accounts
        const finalLedger = await clientB.ledger(group.id).getLedger();
        // Charlie paid 100, owed 50 -> +50; then owed 30 from Groceries -> +20
        expect(finalLedger.getUserBalance(userC.id)).toBe(20);
        // Garcia Family (u1) owed 50 -> -50; then paid 60, owed 30 (+30) -> -20
        expect(finalLedger.getUserBalance(userA.id)).toBe(-20);
    });

    it('supports Smart Cleanup (removeUnusedMember) when switching from an unused Personal Account to a Shared Account', async () => {
        const group = await clientA.groups.create('Road Trip', [
            { username: 'Charlie', email: userC.email }
        ]);

        // User B joins normally first (creates a 3rd row in Members for u2)
        await clientB.groups.joinGroup(group.id);
        let ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(3);
        expect(ledger.members.some(m => m.userId === userB.id)).toBe(true);

        // User B switches to User A's account and triggers Smart Cleanup on their unused u2 row
        const removed = await clientB.ledger(group.id).removeUnusedMember(userB.id);
        expect(removed).toBe(true);
        await clientB.groups.updateGroupAccount(group.id, userA.id);

        ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(2);
        expect(ledger.members.some(m => m.userId === userB.id)).toBe(false);
        expect(await clientB.groups.getGroupAccountId(group.id)).toBe(userA.id);

        // US-COLLAB: Participants overview reflects User B co-managing User A's account
        const participants = await clientA.groups.getGroupParticipants(group.id);
        const managedAccount = participants.accounts.find(a => a.member.userId === userA.id);
        expect(managedAccount).toBeDefined();
        expect(managedAccount?.kind).toBe('shared');
        expect(managedAccount?.managers.some(m => m.email === userB.email)).toBe(true);
        expect(participants.collaborators.some(c => c.email === userB.email)).toBe(true);
    });

    it('allows owner to switch to a shared account and remove their unused initial account while preserving group ownership', async () => {
        // User A creates group with a shared account 'compartida' and invites User B
        const group = await clientA.groups.create('Viaje Amigos', [
            { username: 'compartida' },
            { username: 'Bob', email: userB.email }
        ]);

        let ledger = await clientA.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(3);
        const compartidaAccount = ledger.members.find(m => m.name === 'compartida')!;
        expect(compartidaAccount).toBeDefined();

        // User A switches to manage 'compartida'
        await clientA.groups.updateGroupAccount(group.id, compartidaAccount.userId);
        expect(await clientA.groups.getGroupAccountId(group.id)).toBe(compartidaAccount.userId);

        // User A can remove their unused personal account (userA.id)
        const removed = await clientA.ledger(group.id).removeUnusedMember(userA.id);
        expect(removed).toBe(true);

        ledger = await clientA.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(2);
        expect(ledger.members.some(m => m.userId === userA.id)).toBe(false);

        // User A is STILL group owner in cached settings and when re-importing
        const settings = await clientA.groups.getSettings();
        const cached = settings.groupCache.find(g => g.id === group.id);
        expect(cached?.role).toBe('owner');

        const reimported = await clientA.groups.importGroup(group.id);
        expect(reimported.isOwner).toBe(true);

        // Participants overview shows User A managing compartida with owner status
        const participants = await clientA.groups.getGroupParticipants(group.id);
        const resolvedCompartida = participants.accounts.find(a => a.member.userId === compartidaAccount.userId);
        expect(resolvedCompartida).toBeDefined();
        expect(resolvedCompartida?.kind).toBe('shared');
        expect(resolvedCompartida?.managers.some(m => m.email === userA.email && m.role === 'owner')).toBe(true);
    });

    it('refuses to remove an account in removeUnusedMember if it has transactions or is the last remaining account', async () => {
        const group = await clientA.groups.create('Safety Check', [
            { username: 'Bob', email: userB.email }
        ]);
        await clientB.groups.joinGroup(group.id);
        await clientB.ledger(group.id).getLedger(); // triggers email -> u2 migration

        // Add an expense involving u2
        await clientA.ledger(group.id).addExpense({
            description: 'Taxi',
            amount: 20,
            paidByUserId: userA.id,
            category: 'Transport',
            date: new Date(),
            splits: [
                { userId: userA.id, amount: 10 },
                { userId: userB.id, amount: 10 }
            ]
        });

        // Member with transactions cannot be removed
        const activeMemberRemoved = await clientB.ledger(group.id).removeUnusedMember(userB.id);
        expect(activeMemberRemoved).toBe(false);

        // Cannot remove the only remaining account
        const soloGroup = await clientA.groups.create('Solo Group');
        const soloRemoved = await clientA.ledger(soloGroup.id).removeUnusedMember(userA.id);
        expect(soloRemoved).toBe(false);

        const ledger = await clientA.ledger(group.id).getLedger();
        expect(ledger.members).toHaveLength(2);
    });

    it('preserves a Shared Account in the spreadsheet when one of its co-managers leaves the group', async () => {
        const group = await clientA.groups.create('Family Vacation');
        await clientA.ledger(group.id).renameMember(userA.id, 'Smith Household');

        // User B joins linked to Smith Household (u1)
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        // User B leaves the group
        await clientB.groups.leaveGroup(group.id);

        // Verify group is removed from User B's settings
        const bSettings = await clientB.groups.getSettings();
        expect(bSettings.groupCache.find(g => g.id === group.id)).toBeUndefined();

        // Verify Smith Household (u1) is still in the group for User A
        const aLedger = await clientA.ledger(group.id).getLedger();
        expect(aLedger.members).toHaveLength(1);
        expect(aLedger.members[0].userId).toBe(userA.id);
        expect(aLedger.members[0].name).toBe('Smith Household');
    });

    it('resolves "me" in QuozenAI to the active linked Shared or Offline Account', async () => {
        const group = await clientA.groups.create('AI Trip', [
            { username: 'Charlie', email: userC.email }
        ]);
        await clientA.ledger(group.id).renameMember(userA.id, 'Garcia Family');
        await clientB.groups.joinGroup(group.id, { accountId: userA.id });

        const mockProvider: AiProvider = {
            id: 'mock',
            mode: 'cloud',
            chat: vi.fn().mockResolvedValue({
                type: 'tool_call',
                tool: 'addExpense',
                arguments: {
                    description: 'Museum Tickets',
                    amount: 40,
                    category: 'Entertainment',
                    paidByUserId: 'me',
                    splits: [
                        { userId: 'me', amount: 20 },
                        { userId: userC.email, amount: 20 }
                    ]
                }
            }),
            checkAvailability: vi.fn().mockResolvedValue(true),
            getSetupMessage: () => null
        };

        const aiForB = new QuozenAI(clientB, mockProvider);
        const result = await aiForB.executeCommand('I paid 40 for museum tickets', group.id, 'en');

        expect(result.success).toBe(true);

        const ledger = await clientB.ledger(group.id).getLedger();
        expect(ledger.expenses).toHaveLength(1);
        expect(ledger.expenses[0].paidByUserId).toBe(userA.id); // Resolved 'me' to Shared Account u1, not u2!
        expect(ledger.expenses[0].splits).toEqual([
            { userId: userA.id, amount: 20 },
            { userId: userC.email, amount: 20 }
        ]);
    });

    it('reproduces Madryn 4-user scenario: A & B manage Account X, C & D manage Account Y (belonging to C), D eliminates personal account and can log expenses', async () => {
        // 1. User A creates group "Madryn" and shares with B, C, and D
        const group = await clientA.groups.create('Madryn', [
            { username: 'Bob', email: userB.email },
            { username: 'Account Y', email: userC.email },
            { username: 'Diana', email: userD.email }
        ]);

        // 2. Users A and B configure Account X (A renames account to X, B switches to X and removes B's personal account)
        await clientA.ledger(group.id).renameMember(userA.id, 'Account X');
        await clientB.groups.joinGroup(group.id);
        await clientB.ledger(group.id).getLedger(); // migrates bob@example.com -> u2
        expect(await clientB.ledger(group.id).removeUnusedMember(userB.id)).toBe(true);
        await clientB.groups.updateGroupAccount(group.id, userA.id);

        // 3. User D logs in, switches to Account Y (belonging to C, whose userId is still charlie@example.com before C logs in),
        // and eliminates D's unused personal account
        await clientD.groups.joinGroup(group.id);
        await clientD.ledger(group.id).getLedger(); // migrates diana@example.com -> u4
        expect(await clientD.ledger(group.id).removeUnusedMember(userD.id)).toBe(true);
        await clientD.groups.updateGroupAccount(group.id, userC.email);

        // 4. User C logs in and opens the group (triggers migrateUser: charlie@example.com -> u3)
        await clientC.groups.joinGroup(group.id);
        await clientC.ledger(group.id).getLedger();

        // 5. Verify Share Dialog / Participants Overview shows A & B managing X, and BOTH C & D managing Y
        const participants = await clientA.groups.getGroupParticipants(group.id);
        expect(participants.accounts).toHaveLength(2);

        const accountX = participants.accounts.find(a => a.member.userId === userA.id)!;
        expect(accountX).toBeDefined();
        expect(accountX.kind).toBe('shared');
        expect(accountX.managers.map(m => m.email.toLowerCase()).sort()).toEqual([
            userA.email,
            userB.email
        ]);

        const accountY = participants.accounts.find(a => a.member.userId === userC.id)!;
        expect(accountY).toBeDefined();
        expect(accountY.member.name).toBe('Account Y');
        expect(accountY.kind).toBe('shared');
        expect(accountY.managers.map(m => m.email.toLowerCase()).sort()).toEqual([
            userC.email,
            userD.email
        ]);

        // D must NOT be unassigned!
        expect(participants.unassignedCollaborators).toHaveLength(0);

        // 6. Verify User D can log a new expense without failing assertMembership ("Forbidden")
        const dEffectiveAccountId = await clientD.groups.getGroupAccountId(group.id);
        const expenseByD = await clientD.ledger(group.id, dEffectiveAccountId).addExpense({
            description: 'Whale Watching Tour',
            amount: 120,
            paidByUserId: dEffectiveAccountId || userC.id,
            category: 'Entertainment',
            date: new Date('2026-11-10')
        });

        expect(expenseByD.paidByUserId).toBe(userC.id);
        const finalLedger = await clientD.ledger(group.id).getLedger();
        expect(finalLedger.expenses).toHaveLength(1);
        expect(finalLedger.getUserBalance(userC.id)).toBe(60);
        expect(finalLedger.getUserBalance(userA.id)).toBe(-60);
    });

    it('guarantees consistency upon Cloud Sync when split-brain occurs between user_settings.accountId and _meta.account_managers', async () => {
        const { getRxStorageMemory } = await import('rxdb/plugins/storage-memory');
        const {
            createQuozenDatabase,
            destroyQuozenDatabase,
            CompositeCloudSyncProvider,
            GoogleDriveBlobDriver,
            GoogleSheetsTabularDriver
        } = await import('../src');

        const dbC = await createQuozenDatabase({
            name: `test_madryn_c_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });
        const dbD = await createQuozenDatabase({
            name: `test_madryn_d_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            storage: getRxStorageMemory()
        });

        try {
            const storageC = createPerUserStorage(sharedStorage);
            const storageD = createPerUserStorage(sharedStorage);

            const blobDriverC = new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: storageC });
            const syncProviderC = new CompositeCloudSyncProvider({
                id: 'sync-c',
                name: 'Sync C',
                blobDriver: blobDriverC,
                tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: storageC })
            });
            await syncProviderC.initialize();

            const blobDriverD = new GoogleDriveBlobDriver({ getAccessToken: () => null, storageLayer: storageD });
            const syncProviderD = new CompositeCloudSyncProvider({
                id: 'sync-d',
                name: 'Sync D',
                blobDriver: blobDriverD,
                tabularDriver: new GoogleSheetsTabularDriver({ getAccessToken: () => null, storageLayer: storageD })
            });
            await syncProviderD.initialize();

            const rxClientC = new QuozenClient({
                storage: storageC,
                user: userC,
                db: dbC,
                blobDriver: blobDriverC,
                syncProvider: syncProviderC
            });
            const rxClientD = new QuozenClient({
                storage: storageD,
                user: userD,
                db: dbD,
                blobDriver: blobDriverD,
                syncProvider: syncProviderD
            });

            // 1. User A creates group Madryn with C and D
            const group = await clientA.groups.create('Madryn Sync', [
                { username: 'Account Y', email: userC.email },
                { username: 'Diana', email: userD.email }
            ]);

            // 2. User D joins, switches to C's account (pre-migration ID: charlie@example.com), removes unused personal row
            await rxClientD.groups.joinGroup(group.id);
            await rxClientD.ledger(group.id).getLedger();
            await rxClientD.ledger(group.id).removeUnusedMember(userD.id);
            await rxClientD.groups.updateGroupAccount(group.id, userC.email);
            await rxClientD.replication!.sync(group.id);

            // Simulate split-brain: _meta!account_managers lost D's write (empty {}) AND C logs in and migrates charlie@example.com -> u3
            await clientA.groups.setAccountManagers(group.id, {});
            await rxClientC.groups.joinGroup(group.id);
            await rxClientC.ledger(group.id).getLedger();
            await rxClientC.replication!.sync(group.id);

            // 3. Now D runs Cloud Sync -> must reconcile D's accountId (charlie@example.com -> u3) AND restore _meta!account_managers[u3] = [diana@example.com]
            await rxClientD.replication!.sync(group.id);

            const healedAccountId = await rxClientD.groups.getGroupAccountId(group.id);
            expect(healedAccountId).toBe(userC.id);

            const participants = await clientA.groups.getGroupParticipants(group.id);
            const accountY = participants.accounts.find(a => a.member.userId === userC.id)!;
            expect(accountY).toBeDefined();
            expect(accountY.kind).toBe('shared');
            expect(accountY.managers.map(m => m.email.toLowerCase()).sort()).toEqual([
                userC.email,
                userD.email
            ]);
            expect(participants.unassignedCollaborators).toHaveLength(0);

            // 4. Verify User D can log an expense after sync healing
            const exp = await rxClientD.ledger(group.id, healedAccountId).addExpense({
                description: 'Penguin Excursion',
                amount: 80,
                paidByUserId: healedAccountId!,
                category: 'Entertainment',
                date: new Date('2026-11-10')
            });
            expect(exp.paidByUserId).toBe(userC.id);
        } finally {
            await destroyQuozenDatabase(dbC);
            await destroyQuozenDatabase(dbD);
        }
    });
});
