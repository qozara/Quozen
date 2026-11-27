import { QuozenClient, resolveGroupState, type GroupStatus } from '@quozen/core';

export interface CliActionChoice {
    title: string;
    value: string;
}

export function buildInteractiveActionChoices(status?: GroupStatus): CliActionChoice[] {
    const state = resolveGroupState(status);
    const choices: CliActionChoice[] = [
        { title: 'View Dashboard', value: 'dashboard' },
    ];

    if (state.canCreateCommandDraft) {
        choices.push({ title: 'Ask AI 🤖', value: 'ask_ai' });
    }

    choices.push({ title: 'Switch Group', value: 'switch_group' });
    choices.push({
        title: state.canManageRoster ? 'Switch / Rename Account' : 'Switch Active Account',
        value: 'manage_account',
    });

    if (state.canEditTransactions) {
        choices.push({ title: 'Add Expense', value: 'add_expense' });
        choices.push({ title: 'Record Settlement', value: 'record_settlement' });
    }

    if (state.canClose) {
        choices.push({ title: 'Close Group (Read-Only)', value: 'close_group' });
    } else if (state.canReopen) {
        choices.push({ title: 'Re-open Group', value: 'reopen_group' });
    }

    choices.push({ title: 'Log out', value: 'logout' });
    choices.push({ title: 'Exit', value: 'exit' });

    return choices;
}

export async function runCloseGroupCommand(
    client: QuozenClient,
    groupId: string,
    options?: { force?: boolean }
): Promise<void> {
    await client.groups.closeGroup(groupId, { force: options?.force ?? false });
}

export async function runReopenGroupCommand(
    client: QuozenClient,
    groupId: string
): Promise<void> {
    await client.groups.reopenGroup(groupId);
}
