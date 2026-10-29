import prompts from 'prompts';
import chalk from 'chalk';
import { formatCurrency, CommandDraftService } from '@quozen/core';
import { getQuozenCliClient } from './quozen.js';

export async function startInteractive() {
    console.log(chalk.cyan("Initializing Quozen CLI..."));
    const quozen = await getQuozenCliClient();

    let settings = await quozen.groups.getSettings();
    if (!settings.groupCache || settings.groupCache.length === 0) {
        console.log(chalk.yellow("No groups found. Please create one first in the web app."));
    }

    let activeGroupId = settings.activeGroupId || (settings.groupCache.length > 0 ? settings.groupCache[0].id : null);

    while (true) {
        const activeGroup = settings.groupCache.find((g: any) => g.id === activeGroupId);
        const groupName = activeGroup ? activeGroup.name : 'None';
        const activeAccountId = activeGroup?.accountId || quozen.user.id;
        const activeAccountLabel = activeGroup?.accountId && activeGroup.accountId !== quozen.user.id
            ? activeGroup.accountId
            : (quozen.user.name || quozen.user.email || activeAccountId);

        const { action } = await prompts({
            type: 'select',
            name: 'action',
            message: `Quozen CLI - Select an action (Current Group: ${chalk.green(groupName)} | Account: ${chalk.cyan(activeAccountLabel)})`,
            choices: [
                { title: 'View Dashboard', value: 'dashboard' },
                { title: 'Ask AI 🤖', value: 'ask_ai' },
                { title: 'Switch Group', value: 'switch_group' },
                { title: 'Switch / Rename Account', value: 'manage_account' },
                { title: 'Add Expense', value: 'add_expense' },
                { title: 'Record Settlement', value: 'record_settlement' },
                { title: 'Log out', value: 'logout' },
                { title: 'Exit', value: 'exit' }
            ]
        });

        if (!action || action === 'exit') break;

        try {
            if (action === 'dashboard') {
                if (!activeGroupId) {
                    console.log(chalk.red("No active group selected."));
                    continue;
                }
                const ledger = await quozen.ledger(activeGroupId, activeAccountId).getLedger();
                const balances = ledger.getBalances();
                const activeMember = ledger.members.find(m => m.userId === activeAccountId);

                console.log(chalk.bold(`--- Group Balances (Active Account: ${activeMember?.name || activeAccountLabel}) ---`));
                ledger.members.forEach(m => {
                    const bal = balances[m.userId] || 0;
                    const formattedBal = formatCurrency(Math.abs(bal), settings.preferences.defaultCurrency);
                    const marker = m.userId === activeAccountId ? ' (Active)' : '';

                    if (bal >= 0) {
                        console.log(`${(m.name + marker).padEnd(24)} ${chalk.green(`+${formattedBal}`)}`);
                    } else {
                        console.log(`${(m.name + marker).padEnd(24)} ${chalk.red(`-${formattedBal}`)}`);
                    }
                });
                console.log("");
            } else if (action === 'ask_ai') {
                if (!activeGroupId) {
                    console.log(chalk.red("No active group selected."));
                    continue;
                }

                const { prompt: aiPrompt } = await prompts({
                    type: 'text',
                    name: 'prompt',
                    message: 'What do you want to do?'
                });

                if (aiPrompt) {
                    console.log(chalk.cyan("Processing command..."));

                    const ledgerSvc = quozen.ledger(activeGroupId, activeAccountId);
                    const ledger = await ledgerSvc.getLedger();

                    const draftService = new CommandDraftService();
                    const locale = settings?.preferences?.locale === 'system'
                        ? Intl.DateTimeFormat().resolvedOptions().locale
                        : (settings?.preferences?.locale || 'en');

                    const result = await draftService.createDraft({
                        input: aiPrompt,
                        ledger,
                        activeAccountId,
                        locale,
                        aiEnabled: false
                    });

                    if (result.kind === 'settlement' && result.settlementDraft) {
                        const draft = result.settlementDraft;
                        const fromMember = ledger.members.find(m => m.userId === draft.fromUserId)?.name || draft.fromUserId;
                        const toMember = ledger.members.find(m => m.userId === draft.toUserId)?.name || draft.toUserId;

                        console.log(chalk.bold("\n--- Settlement Draft ---"));
                        console.log(`From:   ${chalk.yellow(fromMember)}`);
                        console.log(`To:     ${chalk.green(toMember)}`);
                        console.log(`Amount: ${chalk.cyan(formatCurrency(draft.amount, settings.preferences.defaultCurrency))}`);
                        console.log(`Method: ${draft.method}`);

                        const { confirm } = await prompts({
                            type: 'confirm',
                            name: 'confirm',
                            message: 'Record this settlement to the ledger?',
                            initial: true
                        });

                        if (confirm) {
                            await ledgerSvc.addSettlement(draft);
                            console.log(chalk.green("✨ Settlement recorded successfully!"));
                        } else {
                            console.log(chalk.yellow("Draft cancelled."));
                        }
                    } else if (result.expenseDraft) {
                        const draft = result.expenseDraft;
                        const payer = ledger.members.find(m => m.userId === draft.paidByUserId)?.name || draft.paidByUserId;

                        console.log(chalk.bold("\n--- Expense Draft ---"));
                        console.log(`Description: ${chalk.bold(draft.description)}`);
                        console.log(`Amount:      ${chalk.cyan(formatCurrency(draft.amount, settings.preferences.defaultCurrency))}`);
                        console.log(`Category:    ${draft.category}`);
                        console.log(`Paid by:     ${chalk.yellow(payer)}`);
                        console.log(`Splits:`);
                        draft.splits.filter(s => s.amount > 0).forEach(s => {
                            const name = ledger.members.find(m => m.userId === s.userId)?.name || s.userId;
                            console.log(`  - ${name}: ${formatCurrency(s.amount, settings.preferences.defaultCurrency)}`);
                        });

                        const { confirm } = await prompts({
                            type: 'confirm',
                            name: 'confirm',
                            message: 'Add this expense to the ledger?',
                            initial: true
                        });

                        if (confirm) {
                            await ledgerSvc.addExpense(draft);
                            console.log(chalk.green("✨ Expense added successfully!"));
                        } else {
                            console.log(chalk.yellow("Draft cancelled."));
                        }
                    } else {
                        console.log(chalk.red("Could not parse action from input."));
                    }
                }
            } else if (action === 'switch_group') {
                const { newGroupId } = await prompts({
                    type: 'select',
                    name: 'newGroupId',
                    message: 'Select a group',
                    choices: settings.groupCache.map((g: any) => ({ title: g.name, value: g.id }))
                });
                if (newGroupId) {
                    activeGroupId = newGroupId;
                    await quozen.groups.updateActiveGroup(newGroupId);
                    settings = await quozen.groups.getSettings();
                }
            } else if (action === 'manage_account') {
                if (!activeGroupId) {
                    console.log(chalk.red("No active group selected."));
                    continue;
                }
                const ledgerSvc = quozen.ledger(activeGroupId, activeAccountId);
                const ledger = await ledgerSvc.getLedger();
                const currentMember = ledger.members.find(m => m.userId === activeAccountId) || ledger.members[0];

                const { accountAction } = await prompts({
                    type: 'select',
                    name: 'accountAction',
                    message: `Manage Account (Current: ${currentMember?.name || activeAccountId})`,
                    choices: [
                        { title: 'Switch Active Account (Personal / Shared / Offline)', value: 'switch' },
                        { title: 'Rename Active Account', value: 'rename' },
                        { title: 'Back', value: 'back' }
                    ]
                });

                if (accountAction === 'switch') {
                    const { newAccountId } = await prompts({
                        type: 'select',
                        name: 'newAccountId',
                        message: 'Select the account you want to manage in this group',
                        choices: ledger.members.map(m => ({
                            title: `${m.name}${m.role === 'owner' ? ' (Owner)' : ''}${m.userId === activeAccountId ? ' ✓' : ''}`,
                            value: m.userId
                        }))
                    });
                    if (newAccountId && newAccountId !== activeAccountId) {
                        await quozen.groups.updateGroupAccount(activeGroupId, newAccountId);
                        settings = await quozen.groups.getSettings();
                        const targetMember = ledger.members.find(m => m.userId === newAccountId);
                        console.log(chalk.green(`Switched active account to "${targetMember?.name || newAccountId}".`));
                    }
                } else if (accountAction === 'rename' && currentMember) {
                    const { newName } = await prompts({
                        type: 'text',
                        name: 'newName',
                        message: 'Enter new account name (e.g., "Garcia Family"):',
                        initial: currentMember.name
                    });
                    if (newName && newName.trim()) {
                        await ledgerSvc.renameMember(currentMember.userId, newName.trim());
                        console.log(chalk.green(`Account renamed to "${newName.trim()}".`));
                    }
                }
            } else if (action === 'add_expense') {
                if (!activeGroupId) continue;
                const ledger = await quozen.ledger(activeGroupId, activeAccountId).getLedger();
                const defaultPayerIndex = Math.max(
                    0,
                    ledger.members.findIndex(m => m.userId === activeAccountId)
                );

                const response = await prompts([
                    { type: 'text', name: 'description', message: 'Description' },
                    { type: 'number', name: 'amount', message: 'Amount', float: true, round: 2 },
                    {
                        type: 'select',
                        name: 'category',
                        message: 'Category',
                        choices: (ledger.categories && ledger.categories.length > 0 ? ledger.categories : [
                            { id: 'food_dining', name: 'Food & Dining' },
                            { id: 'transportation', name: 'Transportation' },
                            { id: 'accommodation', name: 'Accommodation' },
                            { id: 'entertainment', name: 'Entertainment' },
                            { id: 'shopping', name: 'Shopping' },
                            { id: 'other', name: 'Other' }
                        ]).map((c: any) => ({
                            title: c.description ? `${c.name} (${c.description})` : c.name,
                            value: c.id
                        }))
                    },
                    {
                        type: 'select',
                        name: 'paidByUserId',
                        message: 'Who paid?',
                        initial: defaultPayerIndex,
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId }))
                    },
                    {
                        type: 'multiselect',
                        name: 'splitUserIds',
                        message: 'Split between who? (Space to select)',
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId, selected: true })),
                        min: 1
                    }
                ]);

                if (response.description && response.amount && response.splitUserIds) {
                    const splitAmount = Number((response.amount / response.splitUserIds.length).toFixed(2));
                    const splits = response.splitUserIds.map((uid: string) => ({
                        userId: uid,
                        amount: splitAmount
                    }));

                    console.log(chalk.cyan("Adding expense..."));
                    await quozen.ledger(activeGroupId, activeAccountId).addExpense({
                        description: response.description,
                        amount: response.amount,
                        category: response.category,
                        paidByUserId: response.paidByUserId,
                        date: new Date(),
                        splits
                    });
                    console.log(chalk.green("Expense added successfully!"));
                }
            } else if (action === 'record_settlement') {
                if (!activeGroupId) continue;
                const ledger = await quozen.ledger(activeGroupId, activeAccountId).getLedger();

                const response = await prompts([
                    {
                        type: 'select',
                        name: 'fromUserId',
                        message: 'Who is paying?',
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId }))
                    },
                    {
                        type: 'select',
                        name: 'toUserId',
                        message: 'Who is receiving?',
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId }))
                    },
                    { type: 'number', name: 'amount', message: 'Amount', float: true, round: 2 }
                ]);

                if (response.fromUserId && response.toUserId && response.amount) {
                    if (response.fromUserId === response.toUserId) {
                        console.log(chalk.red("Cannot settle with yourself."));
                        continue;
                    }
                    console.log(chalk.cyan("Recording settlement..."));
                    await quozen.ledger(activeGroupId, activeAccountId).addSettlement({
                        fromUserId: response.fromUserId,
                        toUserId: response.toUserId,
                        amount: response.amount,
                        method: 'cash',
                        date: new Date()
                    });
                    console.log(chalk.green("Settlement recorded successfully!"));
                }
            } else if (action === 'logout') {
                const fs = await import('fs/promises');
                const path = await import('path');
                const os = await import('os');
                await fs.unlink(path.join(os.homedir(), '.quozen', 'credentials.json')).catch(() => { });
                console.log(chalk.green("Logged out successfully."));
                break;
            }
        } catch (e: any) {
            console.log(chalk.red(`Error: ${e.message}`));
        }
    }
}
