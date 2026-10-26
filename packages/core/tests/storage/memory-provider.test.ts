import { describe, it, expect, beforeEach } from 'vitest';
import { QuozenClient, InMemoryAdapter, CreateExpenseDTO } from '../../src';

interface User {
    id: string;
    username: string;
    name: string;
    email: string;
}

describe('QuozenClient GroupRepository Integration', () => {
    let client: QuozenClient;
    const mockUser: User = {
        id: 'user1',
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com'
    };

    beforeEach(() => {
        client = new QuozenClient({ storage: new InMemoryAdapter(), user: mockUser });
    });

    it('create group creates a new group and updates settings', async () => {
        const group = await client.groups.create("Test Group");
        expect(group).toBeDefined();
        expect(group.name).toBe("Test Group");
        expect(group.isOwner).toBe(true);

        const settings = await client.groups.getSettings();
        // Reconcile might run on first getSettings call, ensure we check the specific group
        const found = settings.groupCache.some(g => g.id === group.id);
        expect(found).toBe(true);
        expect(settings.groupCache[0].id).toBe(group.id);
        expect(settings.groupCache[0].role).toBe("owner");
    });

    it('add expense adds an expense to the group', async () => {
        const group = await client.groups.create("Test Group");

        const expenseData: CreateExpenseDTO = {
            description: "Lunch",
            amount: 20,
            paidByUserId: "user1",
            category: "Food",
            date: new Date("2023-01-01"),
            splits: [{ userId: "user1", amount: 20 }]
        };

        const ledger = client.ledger(group.id);
        await ledger.addExpense(expenseData);

        const expenses = await ledger.getExpenses();
        expect(expenses).toHaveLength(1);
        expect(expenses[0].description).toBe("Lunch");
        expect(expenses[0].amount).toBe(20);
    });

    it('update group updates name and settings', async () => {
        const group = await client.groups.create("Original Name", [{ username: "old-member" }]);

        await client.groups.updateGroup(group.id, "Updated Name", [{ username: "new-member" }]);

        const settings = await client.groups.getSettings();
        const cached = settings.groupCache.find((g: any) => g.id === group.id);
        expect(cached?.name).toBe("Updated Name");
    });

    it('delete group removes from settings', async () => {
        const group = await client.groups.create("To Delete");

        await client.groups.deleteGroup(group.id);

        const settings = await client.groups.getSettings();
        expect(settings.groupCache).toHaveLength(0);
    });

    it('getSettings initializes settings if file is missing', async () => {
        // Create a group first
        await client.groups.create("Group Initial");

        const settings = await client.groups.getSettings();

        expect(settings.version).toBe(2);
        expect(settings.groupCache).toHaveLength(1);
        expect(settings.groupCache[0].name).toBe("Group Initial");
        expect(settings.preferences.defaultCurrency).toBe("USD");
    });

    it('saveSettings updates settings', async () => {
        // Initial reconcile
        let settings = await client.groups.getSettings();
        settings.preferences.theme = "dark";

        await client.groups.saveSettings(settings);

        settings = await client.groups.getSettings();
        expect(settings.preferences.theme).toBe("dark");
    });
});
