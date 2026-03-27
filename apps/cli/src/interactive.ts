import prompts from 'prompts';
import chalk from 'chalk';
import { formatCurrency, AiProviderFactory, QuozenAI } from '@quozen/core';
import { getQuozenCliClient, getAuthToken } from './quozen.js';

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

        const { action } = await prompts({
            type: 'select',
            name: 'action',
            message: `Quozen CLI - Select an action (Current Group: ${chalk.green(groupName)})`,
            choices: [
                { title: 'View Dashboard', value: 'dashboard' },
                { title: 'Ask AI 🤖', value: 'ask_ai' },
                { title: 'Switch Group', value: 'switch_group' },
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
                const ledger = await quozen.ledger(activeGroupId).getLedger();
                const balances = ledger.getBalances();

                console.log(chalk.bold("--- Group Balances ---"));
                ledger.members.forEach(m => {
                    const bal = balances[m.userId] || 0;
                    const formattedBal = formatCurrency(Math.abs(bal), settings.preferences.defaultCurrency);

                    if (bal >= 0) {
                        console.log(`${m.name.padEnd(20)} ${chalk.green(`+${formattedBal}`)}`);
                    } else {
                        console.log(`${m.name.padEnd(20)} ${chalk.red(`-${formattedBal}`)}`);
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
                    console.log(chalk.cyan("🤖 Processing with AI..."));

                    const config = {
                        providerPreference: (settings?.preferences?.aiProvider || 'auto') as any,
                        encryptedApiKey: settings?.encryptedApiKey,
                        proxyUrl: process.env.VITE_AI_PROXY_URL || 'http://localhost:8788',
                        baseUrl: settings?.preferences?.ollamaBaseUrl || process.env.VITE_OLLAMA_URL || 'http://localhost:11434/api',
                        ollamaModel: settings?.preferences?.ollamaModel || process.env.VITE_OLLAMA_MODEL || 'qwen2.5:0.5b',
                        byokProvider: settings?.preferences?.byokProvider || 'google'
                    };

                    const provider = await AiProviderFactory.createProvider(config, getAuthToken);

                    const ai = new QuozenAI(quozen, provider);

                    const locale = settings?.preferences?.locale === 'system' ? Intl.DateTimeFormat().resolvedOptions().locale : (settings?.preferences?.locale || 'en');
                    const result = await ai.executeCommand(aiPrompt, activeGroupId, locale);

                    if (result.success) {
                        console.log(chalk.green(`✨ ${result.message}`));
                    } else {
                        console.log(chalk.red(`❌ AI Error: ${result.message}`));
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
            } else if (action === 'add_expense') {
                if (!activeGroupId) continue;
                const ledger = await quozen.ledger(activeGroupId).getLedger();

                const response = await prompts([
                    { type: 'text', name: 'description', message: 'Description' },
                    { type: 'number', name: 'amount', message: 'Amount', float: true, round: 2 },
                    {
                        type: 'select',
                        name: 'category',
                        message: 'Category',
                        choices: [
                            { title: 'Food', value: 'Food' },
                            { title: 'Transport', value: 'Transportation' },
                            { title: 'Accommodation', value: 'Accommodation' },
                            { title: 'Other', value: 'Other' }
                        ]
                    },
                    {
                        type: 'select',
                        name: 'paidByUserId',
                        message: 'Who paid?',
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId }))
                    },
                    {
                        type: 'multiselect',
                        name: 'splitUserIds',
                        message: 'Split between who? (Space to select)',
                        choices: ledger.members.map(m => ({ title: m.name, value: m.userId })),
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
                    await quozen.ledger(activeGroupId).addExpense({
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
                const ledger = await quozen.ledger(activeGroupId).getLedger();

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
                    await quozen.ledger(activeGroupId).addSettlement({
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
