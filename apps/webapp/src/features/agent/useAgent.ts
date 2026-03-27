import { useSettings } from "@/hooks/use-settings";
import { useRagContext } from "./useRagContext";
import { QuozenAI } from "@quozen/core";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { quozen } from "@/lib/storage";
import { useAiFeature } from "./AiFeatureContext";

export const useAgent = () => {
    const { settings } = useSettings();
    const { activeGroupId } = useRagContext();
    const { toast } = useToast();
    const { t, i18n } = useTranslation();
    const queryClient = useQueryClient();
    const { provider } = useAiFeature();

    const executeCommand = async (prompt: string) => {
        if (!activeGroupId) {
            toast({
                title: t('agent.noActiveGroup'),
                description: t('agent.selectGroupFirst'),
                variant: "destructive"
            });
            return { success: false };
        }

        if (!provider) {
            toast({
                title: t('agent.errorTitle'),
                description: t('agent.errorGeneric'),
                variant: "destructive"
            });
            return { success: false, message: 'Provider not initialized' };
        }

        try {
            const locale = settings?.preferences?.locale === 'system' ? i18n.language : (settings?.preferences?.locale || 'en');

            const ai = new QuozenAI(quozen, provider);
            const result = await ai.executeCommand(prompt, activeGroupId, locale);

            if (result.success) {
                toast({
                    title: t('common.success'),
                    description: result.message
                });

                // Refresh UI
                await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId, "analytics"] });
            } else {
                let errorDescription = result.message;
                if (result.message === 'QUOTA_EXCEEDED') {
                    errorDescription = t('agent.quotaExceeded');
                } else if (result.message === 'RATE_LIMIT_EXCEEDED') {
                    errorDescription = t('agent.rateLimitExceeded');
                }

                toast({
                    title: t('agent.errorTitle'),
                    description: errorDescription,
                    variant: "destructive"
                });
            }

            return result;
        } catch (error: any) {
            console.error('Agent execution error:', error.stack || error);
            toast({
                title: t('agent.errorTitle'),
                description: error.message || t('agent.errorGeneric'),
                variant: "destructive"
            });
            return { success: false, message: error.message };
        }
    };

    return { executeCommand };
};
