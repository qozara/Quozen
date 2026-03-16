import { AiFactoryConfig, AiProvider, AuthTokenGetter } from './types';
import { ProxyAiProvider } from './ProxyAiProvider';
import { WindowAiProvider } from './WindowAiProvider';
import { LocalOllamaProvider } from './LocalOllamaProvider';

export class AiProviderFactory {
    static async createProvider(config: AiFactoryConfig, getAuthToken: AuthTokenGetter): Promise<AiProvider> {
        const { providerPreference, encryptedApiKey, baseUrl, proxyUrl, byokProvider } = config;

        // Forced Disable
        if (providerPreference === 'disabled') {
            return new DisabledAiProvider();
        }

        // 1. Explicit Selection: BYOK Cloud
        if (providerPreference === 'byok' && encryptedApiKey && proxyUrl) {
            return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey, byokProvider);
        }

        // 2. Explicit Selection: Local Ollama
        if (providerPreference === 'local') {
            return new LocalOllamaProvider(baseUrl, config.ollamaModel);
        }

        // 2.5 Explicit Selection: Local Browser AI
        if (providerPreference === 'local-browser') {
            return new WindowAiProvider();
        }

        // 3. Explicit Selection: Cloud (Team Key / BYOK based on config)
        if (providerPreference === 'cloud' && proxyUrl) {
            return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey, byokProvider);
        }

        // 4. "Auto" Mode Fallback Logic
        if (providerPreference === 'auto') {
            // a) If BYOK exists, use it first
            if (encryptedApiKey && proxyUrl) {
                return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey, byokProvider);
            }

            // b) If Window AI is ready
            const windowProvider = new WindowAiProvider();
            if (await windowProvider.checkAvailability()) {
                return windowProvider;
            }

            // c) If Local Ollama is available
            const localProvider = new LocalOllamaProvider(baseUrl, config.ollamaModel);
            if (await localProvider.checkAvailability()) {
                return localProvider;
            }

            // d) Last resort: Team Key Cloud Proxy
            if (proxyUrl) {
                return new ProxyAiProvider(proxyUrl, getAuthToken, undefined, byokProvider);
            }
        }

        // Fallback for everything else
        return new DisabledAiProvider();
    }

    static getSetupMessage(providerId: string, config?: Partial<AiFactoryConfig>): string | null {
        switch (providerId) {
            case 'local':
            case 'local-ollama':
                return new LocalOllamaProvider(config?.baseUrl || undefined, config?.ollamaModel || undefined).getSetupMessage();
            case 'local-browser':
            case 'window-ai':
                return new WindowAiProvider().getSetupMessage();
            case 'byok':
                return "Enter your Gemini API key below. It will be encrypted and stored in your Google Drive.";
            case 'cloud':
                return "Using Quozen Team Key (Rate-limited).";
            default:
                return null;
        }
    }
}

class DisabledAiProvider implements AiProvider {
    readonly id = 'disabled';
    readonly mode = 'disabled';
    async chat() { return { type: 'text' as const, error: 'AI is disabled' }; }
    async checkAvailability() { return false; }
    getSetupMessage() { return null; }
}
