import { useSettings } from "@/hooks/use-settings";
import { useRagContext } from "./useRagContext";
import { agentTools as tools, AgentOrchestrator } from "@quozen/core";
import { quozen } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/tokenStore";
import { useTranslation } from "react-i18next";

import { agentClient } from "@/lib/agent";

export const useAgent = () => {
    const { settings } = useSettings();
    const { systemPrompt, ledger, activeGroupId } = useRagContext();
    const { toast } = useToast();
    const { t } = useTranslation();
    const queryClient = useQueryClient();

    const handleToolCall = async (tool: string, args: any) => {
        if (!activeGroupId) return { success: false };

        if (tool === 'addExpense') {
            await quozen.ledger(activeGroupId).addExpense({
                ...args,
                date: new Date(),
            });
            toast({
                title: t('agent.expenseAdded'),
                description: t('agent.expenseAddedDesc', { description: args.description, amount: args.amount })
            });
        } else if (tool === 'addSettlement') {
            await quozen.ledger(activeGroupId).addSettlement({
                ...args,
                date: new Date(),
                method: args.method || 'Cash'
            });
            toast({
                title: t('agent.settlementRecorded'),
                description: t('agent.settlementRecordedDesc', { amount: args.amount })
            });
        }

        // Refresh UI
        await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
        await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId, "analytics"] });

        return { success: true };
    };

    const executeProxyCommand = async (prompt: string) => {
        const ciphertext = settings?.encryptedApiKey;

        const result = await agentClient.chat({
            messages: [{ role: 'user', content: prompt }],
            systemPrompt,
            tools,
            ciphertext
        });

        if (result.type === 'tool_call' && result.tool) {
            const validation = AgentOrchestrator.validateResponse(result);
            if (!validation.isValid) {
                return { success: false, message: validation.error };
            }
            return await handleToolCall(result.tool, result.arguments);
        } else {
            return { success: false, message: result.content || result.message || AgentOrchestrator.getErrorMessage() };
        }
    };

    const executeLocalCommand = async (prompt: string) => {
        const ai = (window as any).ai;
        if (!ai || !ai.languageModel) throw new Error(t('agent.localAiNotAvailable'));

        const fewShotExamples = `
User: "I paid 100 for lunch split with Alice"
Output: {"tool": "addExpense", "arguments": {"description": "lunch", "amount": 100, "paidByUserId": "user-id-of-payer", "splits": [{"userId": "user-id-of-payer", "amount": 50}, {"userId": "user-id-of-alice", "amount": 50}]}}

User: "Bob paid 40 bucks for drinks"
Output: {"tool": "addExpense", "arguments": {"description": "drinks", "amount": 40, "paidByUserId": "user-id-of-bob", "splits": []}}

User: "I sent 20 to Alice for the pizza"
Output: {"tool": "addSettlement", "arguments": {"fromUserId": "user-id-of-sender", "toUserId": "user-id-of-alice", "amount": 20, "method": "Cash", "notes": "pizza"}}
`;

        const session = await ai.languageModel.create({
            systemPrompt: `${systemPrompt}\n\nFew-shot examples:\n${fewShotExamples}`
        });

        const response = await session.prompt(prompt);

        const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
            const result = JSON.parse(jsonMatch[1]);
            return await handleToolCall(result.tool, result.arguments);
        }

        throw new Error(t('agent.localAiInvalidJson'));
    };

    const executeCommand = async (prompt: string) => {
        if (!ledger) {
            toast({
                title: t('agent.noActiveGroup'),
                description: t('agent.selectGroupFirst'),
                variant: "destructive"
            });
            return { success: false };
        }

        const provider = settings?.preferences?.aiProvider || 'auto';

        try {
            // Waterfall Strategy
            if (provider === 'local') {
                return await executeLocalCommand(prompt);
            }

            if (provider === 'byok' || provider === 'cloud') {
                return await executeProxyCommand(prompt);
            }

            // Auto routing: BYOK -> Local AI -> Cloud Proxy
            if (provider === 'auto') {
                if (settings?.encryptedApiKey) {
                    return await executeProxyCommand(prompt);
                }

                const ai = (window as any).ai;
                if (ai?.languageModel) {
                    const capabilities = await ai.languageModel.capabilities();
                    if (capabilities.available === 'readily') {
                        try {
                            return await executeLocalCommand(prompt);
                        } catch (e) {
                            console.warn("Local AI failed, falling back to proxy", e);
                        }
                    }
                }

                return await executeProxyCommand(prompt);
            }

            return { success: false, message: t('agent.disabled') };

        } catch (error: any) {
            console.error('Agent execution error:', error);
            toast({
                title: t('agent.errorTitle'),
                description: error.message || t('agent.errorGeneric'),
                variant: "destructive"
            });
            return { success: false, error };
        }
    };

    return { executeCommand };
};
