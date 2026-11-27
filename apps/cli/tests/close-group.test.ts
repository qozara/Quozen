import { describe, it, expect } from 'vitest';
import { QuozenClient, InMemoryAdapter, GroupNotSettledError, type User } from '@quozen/core';
import { buildInteractiveActionChoices, runCloseGroupCommand, runReopenGroupCommand } from '../src/group-lifecycle';

describe('CLI Group Close / Re-open', () => {
    const owner: User = { id: 'u1', username: 'alice', email: 'alice@example.com', name: 'Alice' };

    it('hides write actions and shows Re-open Group in interactive menu when group is closed', () => {
        const openChoices = buildInteractiveActionChoices('open').map(c => c.value);
        expect(openChoices).toContain('add_expense');
        expect(openChoices).toContain('record_settlement');
        expect(openChoices).toContain('ask_ai');
        expect(openChoices).toContain('close_group');
        expect(openChoices).not.toContain('reopen_group');

        const closedChoices = buildInteractiveActionChoices('closed').map(c => c.value);
        expect(closedChoices).not.toContain('add_expense');
        expect(closedChoices).not.toContain('record_settlement');
        expect(closedChoices).not.toContain('ask_ai');
        expect(closedChoices).not.toContain('close_group');
        expect(closedChoices).toContain('reopen_group');
        expect(closedChoices).toContain('dashboard');
        expect(closedChoices).toContain('switch_group');
    });

    it('closes settled group, rejects unsettled without force, supports force close, and reopens via CLI handlers', async () => {
        const adapter = new InMemoryAdapter();
        const client = new QuozenClient({ storage: adapter as any, user: owner });
        const group = await client.groups.create('CLI Trip', [{ username: 'bob' }]);

        await client.ledger(group.id).addExpense({
            description: 'Tickets',
            amount: 60,
            category: 'transportation',
            date: new Date(),
            paidByUserId: owner.id,
        });

        await expect(runCloseGroupCommand(client, group.id, { force: false })).rejects.toThrow(GroupNotSettledError);

        await runCloseGroupCommand(client, group.id, { force: true });
        expect(await client.groups.getGroupStatus(group.id)).toBe('closed');

        await runReopenGroupCommand(client, group.id);
        expect(await client.groups.getGroupStatus(group.id)).toBe('open');
    });
});
