import { QuozenClient } from '../QuozenClient';
import { AiProvider } from './providers/types';
import { AgentOrchestrator } from './Orchestrator';
import { agentTools } from './tools';
import { distributeAmount } from '../finance';

export class QuozenAI {
    constructor(
        private client: QuozenClient,
        private provider: AiProvider
    ) { }

    async executeCommand(prompt: string, activeGroupId: string, locale: string = 'en'): Promise<{ success: boolean; message: string }> {
        try {
            // 1. Fetch the Ledger
            const ledgerService = this.client.ledger(activeGroupId);
            const ledger = await ledgerService.getLedger();

            // 2. Build system prompt
            const systemPrompt = AgentOrchestrator.buildSystemPrompt({
                activeGroupId,
                me: this.client.user,
                ledger,
                locale
            });

            // 3. Invoke Provider
            const response = await this.provider.chat({
                messages: [{ role: 'user', content: prompt }],
                systemPrompt,
                tools: agentTools
            });

            if (response.error) {
                return { success: false, message: response.error };
            }

            // 4. Validate output
            const validation = AgentOrchestrator.validateResponse(response);
            if (!validation.isValid) {
                return { success: false, message: validation.error || 'Invalid AI response' };
            }

            // 5. Execute tool
            if (response.type === 'tool_call' && response.tool && response.arguments) {
                let args = response.arguments;

                // Normalize stringified JSON returned by some local LLMs
                if (typeof args === 'string') {
                    try { args = JSON.parse(args); } catch (e) { throw new Error("AI returned malformed arguments"); }
                }

                const toolName = response.tool.toLowerCase();

                // Normalize IDs (some LLMs return names instead of IDs)
                const resolveId = (idOrName: string) => {
                    if (!idOrName || typeof idOrName !== 'string') return idOrName;
                    const lowerIdOrName = idOrName.toLowerCase().trim();
                    if (lowerIdOrName === 'me' || lowerIdOrName === 'i' || lowerIdOrName === 'myself') return this.client.user.id;

                    let member = ledger.members.find(m => m.name.toLowerCase().trim() === lowerIdOrName);
                    if (!member) {
                        member = ledger.members.find(m =>
                            m.userId.toLowerCase().trim() === lowerIdOrName ||
                            m.email?.toLowerCase().trim() === lowerIdOrName ||
                            m.name.toLowerCase().includes(lowerIdOrName)
                        );
                    }
                    return member ? member.userId : idOrName;
                };

                console.log(`[QuozenAI] Parsed LLM Args for ${toolName}:`, JSON.stringify(args));

                if (toolName === 'addexpense') {
                    if (!args.date) args.date = new Date();
                    if (!args.category) args.category = "Other";
                    if (!args.description) args.description = args.category !== "Other" ? args.category : "AI Expense";

                    if (args.amount !== undefined) args.amount = Number(args.amount) || 0;
                    if (args.paidByUserId) args.paidByUserId = resolveId(args.paidByUserId);

                    // Defensively parse stringified arrays or objects
                    const parseObjectOrArray = (val: any) => {
                        if (typeof val === 'object' && val !== null) return val;
                        if (typeof val === 'string') {
                            try {
                                const parsed = JSON.parse(val);
                                if (typeof parsed === 'object' && parsed !== null) return parsed;
                            } catch (e) { }
                        }
                        return null;
                    };
                    const parseArray = (val: any) => {
                        const parsed = parseObjectOrArray(val);
                        return Array.isArray(parsed) ? parsed : null;
                    };

                    const exactAmounts = parseObjectOrArray(args.exactAmounts);
                    const splits = parseObjectOrArray(args.splits);
                    const specificMembers = parseArray(args.specificMembers);

                    // Smart Inference: Don't rely on the LLM explicitly setting the enum string.
                    // Look at the arrays/objects it actually populated.
                    let strategy = args.splitStrategy;
                    if (exactAmounts && Object.keys(exactAmounts).length > 0) {
                        strategy = 'exact_amounts';
                        args.exactAmounts = exactAmounts;
                    } else if (splits && Object.keys(splits).length > 0) {
                        strategy = 'exact_amounts';
                        args.exactAmounts = splits; // Fallback for old schema hallucinations
                    } else if (specificMembers && specificMembers.length > 0) {
                        strategy = 'equally_specific_members';
                        args.specificMembers = specificMembers;
                    } else if (!strategy) {
                        strategy = 'equally_everyone';
                    }

                    let finalSplits: any[] = [];

                    if (strategy === 'equally_everyone') {
                        finalSplits = []; // LedgerService automatically handles this
                    } else if (strategy === 'equally_specific_members' && Array.isArray(args.specificMembers) && args.specificMembers.length > 0) {
                        const resolvedIds = args.specificMembers.map((m: string) => resolveId(m));
                        const amounts = distributeAmount(args.amount, resolvedIds.length);
                        finalSplits = resolvedIds.map((userId: string, i: number) => ({ userId, amount: amounts[i] }));
                    } else if (strategy === 'exact_amounts' && args.exactAmounts) {
                        if (Array.isArray(args.exactAmounts)) {
                            finalSplits = args.exactAmounts.map((a: any) => ({
                                userId: resolveId(a.name || a.userId || a.user),
                                amount: Number(a.amount) || 0
                            }));
                        } else {
                            finalSplits = Object.entries(args.exactAmounts).map(([name, amount]) => ({
                                userId: resolveId(name),
                                amount: Number(amount) || 0
                            }));
                        }

                        // Payer absorbs the difference
                        const splitSum = finalSplits.reduce((sum, s) => sum + s.amount, 0);
                        const diff = args.amount - splitSum;
                        if (Math.abs(diff) > 0.01 && args.paidByUserId) {
                            const payerSplit = finalSplits.find(s => s.userId === args.paidByUserId);
                            if (payerSplit) {
                                payerSplit.amount += diff;
                            } else {
                                finalSplits.push({ userId: args.paidByUserId, amount: diff });
                            }
                        }

                        // For testing & exactness, ensure members who owe nothing are present with 0
                        ledger.members.forEach(m => {
                            if (!finalSplits.some(s => s.userId === m.userId)) {
                                finalSplits.push({ userId: m.userId, amount: 0 });
                            }
                        });
                    }

                    args.splits = finalSplits;
                    await ledgerService.addExpense(args);
                    return { success: true, message: `Added expense: ${args.description}` };
                } else if (toolName === 'addsettlement') {
                    if (!args.date) args.date = new Date();
                    if (!args.method) args.method = "cash";
                    if (args.amount !== undefined) args.amount = Number(args.amount) || 0;
                    if (args.fromUserId) args.fromUserId = resolveId(args.fromUserId);
                    if (args.toUserId) args.toUserId = resolveId(args.toUserId);
                    await ledgerService.addSettlement(args);
                    return { success: true, message: `Recorded settlement from ${args.fromUserId} to ${args.toUserId}` };
                } else if (toolName === 'rejectrequest') {
                    return { success: false, message: args.reason || "I can only help you manage expenses and settlements." };
                }
            }

            if (response.type === 'text' && response.content) {
                return { success: true, message: response.content };
            }

            return { success: false, message: 'No action taken' };
        } catch (error: any) {
            return { success: false, message: error.message || 'AI execution failed' };
        }
    }
}
