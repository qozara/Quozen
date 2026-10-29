import {
    AiProviderFactory as BaseAiProviderFactory,
    DisabledAiProvider,
    ProxyAiProvider,
    WindowAiProvider,
    type AiFactoryConfig,
    type AuthTokenGetter,
    type AiProvider
} from '@qozara/ai-client';

export { DisabledAiProvider };

export interface QuozenAiFactoryConfig extends Omit<AiFactoryConfig, 'providerPreference'> {
    providerPreference?: 'auto' | 'byok' | 'local' | 'local-browser' | 'cloud' | 'disabled';
    enableLocalAi?: boolean;
}

export class AiProviderFactory {
    static async createProvider(config: QuozenAiFactoryConfig, getAuthToken?: AuthTokenGetter): Promise<AiProvider> {
        const { providerPreference, enableLocalAi, encryptedApiKey, proxyUrl, byokProvider } = config;

        if (providerPreference === 'disabled') {
            return new DisabledAiProvider();
        }

        // When local network AI is NOT explicitly enabled:
        // NEVER probe or instantiate LocalOllamaProvider (localhost:11434) to avoid triggering browser network permissions.
        if (!enableLocalAi) {
            if (providerPreference === 'local') {
                return new DisabledAiProvider();
            }

            if (providerPreference === 'auto') {
                // Safe Automatic Waterfall (Zero localhost/Private Network access):
                // 1. User's own API key (BYOK via cloud proxy)
                if (encryptedApiKey && proxyUrl) {
                    return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey, byokProvider);
                }
                // 2. Browser On-Device AI (window.ai / Gemini Nano, purely in-process)
                const windowProvider = new WindowAiProvider();
                if (await windowProvider.checkAvailability()) {
                    return windowProvider;
                }
                // 3. Fallback: Cloud proxy (Qozara Intelligence)
                if (proxyUrl) {
                    return new ProxyAiProvider(proxyUrl, getAuthToken, undefined, byokProvider);
                }
                return new DisabledAiProvider();
            }
        }

        // If enableLocalAi is explicitly true:
        return BaseAiProviderFactory.createProvider(config as AiFactoryConfig, getAuthToken);
    }

    static getSetupMessage(providerId: string, config?: any): string | null {
        return BaseAiProviderFactory.getSetupMessage(providerId, config);
    }
}
