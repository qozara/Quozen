import { useSettings } from "@/hooks/use-settings";
import { useRagContext } from "./useRagContext";
import { QuozenAI, AiProviderFactory } from "@quozen/core";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthToken } from "@/lib/tokenStore";
import { useTranslation } from "react-i18next";
import { quozen } from "@/lib/storage";

export const useAgent = () => {
    const { settings } = useSettings();
    const { activeGroupId } = useRagContext();
    const { toast } = useToast();
    const { t } = useTranslation();
    const queryClient = useQueryClient();

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
            const config = {
                providerPreference: (settings?.preferences?.aiProvider || 'auto') as any,
                encryptedApiKey: settings?.encryptedApiKey,
                baseUrl: (import.meta as any).env?.VITE_OLLAMA_URL || 'http://localhost:11434/api',
                proxyUrl: (import.meta as any).env?.VITE_AI_PROXY_URL
            };

            const provider = await AiProviderFactory.createProvider(config, getAuthToken);

            const ai = new QuozenAI(quozen, provider);
            const result = await ai.executeCommand(prompt, activeGroupId);

            if (result.success) {
                toast({
                    title: t('common.success'),
                    description: result.message
                });

                // Refresh UI
                await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId] });
                await queryClient.invalidateQueries({ queryKey: ["drive", "group", activeGroupId, "analytics"] });
            } else {
                toast({
                    title: t('agent.errorTitle'),
                    description: result.message,
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
