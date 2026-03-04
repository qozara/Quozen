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
                    await ledgerService.addExpense(response.arguments);
                    return { success: true, message: `Added expense: ${response.arguments.description}` };
                } else if (response.tool === 'addSettlement') {
                    await ledgerService.addSettlement(response.arguments);
                    return { success: true, message: `Recorded settlement from ${response.arguments.fromUserId} to ${response.arguments.toUserId}` };
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
