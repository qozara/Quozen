import { useSettings } from "@/hooks/use-settings";
import { useRagContext } from "./useRagContext";
import { CommandDraftService } from "@quozen/core";
import { LlmIntentEscalator } from "@quozen/ai-services";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { quozen } from "@/lib/storage";
import { useAiFeature } from "./AiFeatureContext";
import { useAppContext } from "@/context/app-context";
import { getAuthToken } from "@/lib/tokenStore";

export const useAgent = () => {
    const { settings } = useSettings();
    const { activeGroupId, currentUserId } = useRagContext();
    const { toast } = useToast();
    const { t, i18n } = useTranslation();
    const { status: aiStatus } = useAiFeature();
    const { openExpenseWithDraft, openSettlementWithDraft } = useAppContext();

    const executeCommand = async (prompt: string) => {
        if (!activeGroupId) {
            toast({
                title: t('agent.noActiveGroup'),
                description: t('agent.selectGroupFirst'),
                variant: "destructive"
            });
            return { success: false };
        }

        try {
            const locale = settings?.preferences?.locale === 'system' ? i18n.language : (settings?.preferences?.locale || 'en');
            const ledger = await quozen.ledger(activeGroupId, currentUserId).getLedger();

            // Set up optional AI escalator if available
            let escalator: LlmIntentEscalator | undefined;
            const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
            if (aiStatus === 'available' && isOnline) {
                escalator = new LlmIntentEscalator({
                    proxyUrl: (import.meta as any).env.VITE_AI_PROXY_URL || 'http://localhost:8788',
                    provider: settings?.preferences?.aiProvider as any,
                    ciphertext: settings?.encryptedApiKey,
                    byokProvider: settings?.preferences?.byokProvider,
                    enableLocalAi: settings?.preferences?.enableLocalAi ?? false,
                    ollamaBaseUrl: settings?.preferences?.ollamaBaseUrl,
                    ollamaModel: settings?.preferences?.ollamaModel,
                    getAuthToken
                });
            }

            const draftService = new CommandDraftService({ escalator });
            const result = await draftService.createDraft({
                input: prompt,
                ledger,
                activeAccountId: currentUserId,
                locale,
                genAiEnabled: Boolean(escalator)
            });

            if (result.kind === 'settlement' && result.settlementDraft) {
                openSettlementWithDraft(result.settlementDraft, {
                    rawInput: prompt,
                    isAiEscalated: result.isAiEscalated,
                    ambiguities: result.ambiguities
                });
                return { success: true, message: 'Settlement draft created' };
            }

            if (result.expenseDraft) {
                openExpenseWithDraft(result.expenseDraft, {
                    rawInput: prompt,
                    isAiEscalated: result.isAiEscalated,
                    ambiguities: result.ambiguities
                });
                return { success: true, message: 'Expense draft created' };
            }

            toast({
                title: t('agent.errorTitle'),
                description: t('agent.errorGeneric'),
                variant: "destructive"
            });
            return { success: false };
        } catch (error: any) {
            console.error('Agent execution error:', error.stack || error);
            let description = error.message || t('agent.errorGeneric');
            if (error?.code === 'FORBIDDEN_NOT_REGISTERED') {
                description = t('agent.accountNotRegistered');
            } else if (error?.code === 'AUTHENTICATION_REQUIRED') {
                description = t('agent.sessionExpired');
            } else if (error?.code === 'RATE_LIMIT_EXCEEDED') {
                description = t('agent.quotaExceeded');
            }
            toast({
                title: t('agent.errorTitle'),
                description,
                variant: "destructive"
            });
            return { success: false, message: description };
        }
    };

    return { executeCommand };
};
