import { describe, it, expect, beforeEach } from 'vitest';
import { QuozenClient, InMemoryAdapter, Member } from '../../src';

interface User {
    id: string;
    username: string;
    name: string;
    email: string;
}

describe('Storage Logic & Data Integrity', () => {
    let client: QuozenClient;
    const ownerUser: User = {
        id: 'owner-google-id',
        username: 'owner',
        name: 'Owner',
        email: 'owner@example.com'
    };

    const invitedEmail = 'invited@example.com';
    const invitedUserGoogleId = 'invited-google-id';

    beforeEach(() => {
        client = new QuozenClient({ storage: new InMemoryAdapter(), user: ownerUser });
    });

    it('Fix Verification: invited user has Email as ID, but leaveGroup handles it via lookup', async () => {
        // 1. Owner creates group and invites user by email
        const group = await client.groups.create("Test Group", [{ email: invitedEmail }]);

        // 2. Verify storage state: The invited member has userId == email
        const ledger = client.ledger(group.id);
        const members = await ledger.getMembers();
        const invitedMember = members.find((m: Member) => m.email === invitedEmail);

        expect(invitedMember).toBeDefined();
        // In the "Create" phase, ID is still email. 
        expect(invitedMember?.userId).toBe(invitedEmail);

        // 3. Invited user logs in (simulated) and tries to leave using their Google ID
        const invitedClient = new QuozenClient({ storage: (client as any).storage, user: { id: invitedUserGoogleId, email: invitedEmail, name: 'Invited', username: 'invited' } });
        await expect(invitedClient.groups.leaveGroup(group.id)).resolves.not.toThrow();
    });

    it('Fix Verification: Role should be "owner" consistently', async () => {
        const group = await client.groups.create("Test Group");
        const ledger = client.ledger(group.id);
        const members = await ledger.getMembers();
        const owner = members.find((m: Member) => m.userId === ownerUser.id);

        expect(owner?.role).toBe("owner");
    });

    it('Failing test: User ID migration from email to Google ID on joinGroup', async () => {
        // 1. Owner creates group and invites user by email
        const group = await client.groups.create("Test Group", [{ email: invitedEmail }]);
        const ledger = client.ledger(group.id);

        // 2. Add an expense paid by the invited user (their ID is currently their email)
        await ledger.addExpense({
            date: '2023-10-27',
            description: 'Dinner',
            amount: 100,
            paidByUserId: invitedEmail, // they were added by email, so their userId is the email
            category: 'Food',
            splits: [{ userId: ownerUser.id, amount: 50 }, { userId: invitedEmail, amount: 50 }]
        } as any);

        // 3. Invited user joins the group via magic link
        const invitedClient = new QuozenClient({ 
            storage: (client as any).storage, 
            user: { id: invitedUserGoogleId, email: invitedEmail, name: 'Invited', username: 'invited' } 
        });
        await invitedClient.groups.joinGroup(group.id);

        // 4. Verify that the invited user's ID was migrated in the members list
        const updatedMembers = await ledger.getMembers();
        const invitedMember = updatedMembers.find((m: Member) => m.email === invitedEmail);
        
        expect(invitedMember).toBeDefined();
        // The userId should have been migrated to the new Google ID
        expect(invitedMember?.userId).toBe(invitedUserGoogleId);

        // 5. Verify that the expense was also migrated
        const expenses = await ledger.getExpenses();
        console.log("EXPENSES AFTER JOIN:", JSON.stringify(expenses, null, 2));
        expect(expenses.length).toBe(1);
        expect((expenses[0] as any).paidByUserId || (expenses[0] as any).paidBy).toBe(invitedUserGoogleId);
        expect(expenses[0].splits.find(s => s.userId === invitedUserGoogleId)).toBeDefined();
    });
    it('JIT Migration: User ID migration on LedgerService.getLedger (reconcileGroups workflow)', async () => {
        // 1. Owner creates group and invites user by email
        const group = await client.groups.create("Test Group 2", [{ email: invitedEmail }]);
        const ledger = client.ledger(group.id);

        // 2. Add an expense paid by the invited user
        await ledger.addExpense({
            date: '2023-10-27',
            description: 'Lunch',
            amount: 50,
            paidByUserId: invitedEmail, 
            category: 'Food',
            splits: [{ userId: ownerUser.id, amount: 25 }, { userId: invitedEmail, amount: 25 }]
        } as any);

        // 3. User accesses the group via UI (which initializes QuozenClient and calls getLedger)
        const invitedClient = new QuozenClient({ 
            storage: (client as any).storage, 
            user: { id: invitedUserGoogleId, email: invitedEmail, name: 'Invited', username: 'invited' } 
        });
        
        // This simulates opening the group in the UI (triggers JIT migration)
        const invitedLedger = await invitedClient.ledger(group.id).getLedger();

        // 4. Verify that the in-memory ledger data was migrated
        const invitedMember = invitedLedger.members.find((m: Member) => m.email === invitedEmail);
        expect(invitedMember).toBeDefined();
        expect(invitedMember?.userId).toBe(invitedUserGoogleId);

        expect(invitedLedger.expenses.length).toBe(1);
        expect(invitedLedger.expenses[0].paidByUserId).toBe(invitedUserGoogleId);
        expect(invitedLedger.expenses[0].splits.find(s => s.userId === invitedUserGoogleId)).toBeDefined();

        // 5. Verify that the storage was actually updated (by loading a fresh ledger as the owner)
        const ownerLedger = await client.ledger(group.id).getLedger();
        const storedMember = ownerLedger.members.find((m: Member) => m.email === invitedEmail);
        expect(storedMember?.userId).toBe(invitedUserGoogleId);
        expect(ownerLedger.expenses[0].paidByUserId).toBe(invitedUserGoogleId);
    });
});
