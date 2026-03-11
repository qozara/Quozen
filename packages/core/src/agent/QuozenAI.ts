import { QuozenClient } from '../QuozenClient';
import { AiProvider } from './providers/types';
import { AgentOrchestrator } from './Orchestrator';
import { agentTools } from './tools';

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
                    if (!idOrName) return idOrName;
                    const lowerIdOrName = idOrName.toLowerCase();
                    if (lowerIdOrName === 'me' || lowerIdOrName === 'i' || lowerIdOrName === 'myself') return this.client.user.id;
                    const member = ledger.members.find(m => 
                        m.userId === idOrName || 
                        m.name.toLowerCase() === lowerIdOrName || 
                        m.email?.toLowerCase() === lowerIdOrName ||
                        m.name.toLowerCase().includes(lowerIdOrName)
                    );
                    return member ? member.userId : idOrName;
                };

                if (toolName === 'addexpense') {
                    if (!args.date) args.date = new Date();
                    if (!args.category) args.category = "Other";
                    if (!args.description) args.description = args.category || "AI Expense";
                    if (args.paidByUserId) args.paidByUserId = resolveId(args.paidByUserId);
                    if (args.splits) {
                        args.splits = args.splits.map((s: any) => ({ ...s, userId: resolveId(s.userId) }));
                        
                        // Balance splits if they don't match total amount (assign remainder to payer)
                        const splitSum = args.splits.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
                        const diff = (args.amount || 0) - splitSum;
                        if (Math.abs(diff) > 0.01 && args.paidByUserId) {
                            const payerSplit = args.splits.find((s: any) => s.userId === args.paidByUserId);
                            if (payerSplit) {
                                payerSplit.amount = (payerSplit.amount || 0) + diff;
                            } else {
                                args.splits.push({ userId: args.paidByUserId, amount: diff });
                            }
                        }
                    }
                    await ledgerService.addExpense(args);
                    return { success: true, message: `Added expense: ${args.description}` };
                } else if (toolName === 'addsettlement') {
                    if (!args.date) args.date = new Date();
                    if (!args.method) args.method = "cash";
                    if (args.fromUserId) args.fromUserId = resolveId(args.fromUserId);
                    if (args.toUserId) args.toUserId = resolveId(args.toUserId);
                    await ledgerService.addSettlement(args);
                    return { success: true, message: `Recorded settlement from ${args.fromUserId} to ${args.toUserId}` };
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
