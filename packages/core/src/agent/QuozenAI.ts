import { QuozenClient } from '../QuozenClient';
import { AiProvider } from './providers/types';
import { AgentOrchestrator } from './Orchestrator';
import { agentTools } from './tools';

export class QuozenAI {
    constructor(
        private client: QuozenClient,
        private provider: AiProvider
    ) { }

    async executeCommand(prompt: string, activeGroupId: string): Promise<{ success: boolean; message: string }> {
        try {
            // 1. Fetch the Ledger
            const ledgerService = this.client.ledger(activeGroupId);
            const ledger = await ledgerService.getLedger();

            // 2. Build system prompt
            const systemPrompt = AgentOrchestrator.buildSystemPrompt({
                activeGroupId,
                me: this.client.user,
                ledger
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
                if (response.tool === 'addExpense') {
                    const args = response.arguments;
                    if (!args.date) args.date = new Date();
                    await ledgerService.addExpense(args);
                    return { success: true, message: `Added expense: ${args.description}` };
                } else if (response.tool === 'addSettlement') {
                    const args = response.arguments;
                    if (!args.date) args.date = new Date();
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
