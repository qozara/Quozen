import { AiFactoryConfig, AiProvider, AuthTokenGetter } from './types';
import { ProxyAiProvider } from './ProxyAiProvider';
import { WindowAiProvider } from './WindowAiProvider';
import { LocalOllamaProvider } from './LocalOllamaProvider';

export class AiProviderFactory {
    static async createProvider(config: AiFactoryConfig, getAuthToken: AuthTokenGetter): Promise<AiProvider> {
        const { providerPreference, encryptedApiKey, baseUrl, proxyUrl } = config;

        // Forced Disable
        if (providerPreference === 'disabled') {
            return new DisabledAiProvider();
        }

        // 1. Explicit Selection: BYOK Cloud
        if (providerPreference === 'byok' && encryptedApiKey && proxyUrl) {
            return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey);
        }

        // 2. Explicit Selection: Local Ollama
        if (providerPreference === 'local') {
            return new LocalOllamaProvider(baseUrl || 'http://localhost:11434/api');
        }

        // 3. Explicit Selection: Cloud (Team Key / BYOK based on config)
        if (providerPreference === 'cloud' && proxyUrl) {
            return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey);
        }

        // 4. "Auto" Mode Fallback Logic
        if (providerPreference === 'auto') {
            // a) If BYOK exists, use it first
            if (encryptedApiKey && proxyUrl) {
                return new ProxyAiProvider(proxyUrl, getAuthToken, encryptedApiKey);
            }

            // b) If Window AI is ready
            const windowProvider = new WindowAiProvider();
            if (await windowProvider.checkAvailability()) {
                return windowProvider;
            }

            // c) Last resort: Team Key Cloud Proxy
            if (proxyUrl) {
                return new ProxyAiProvider(proxyUrl, getAuthToken);
            }
        }

        // Fallback for everything else
        return new DisabledAiProvider();
    }

    static getSetupMessage(providerId: string): string | null {
        switch (providerId) {
            case 'local':
            case 'local-ollama':
                return new LocalOllamaProvider().getSetupMessage();
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
    async chat() { return { type: 'text' as const, error: 'AI is disabled' }; }
    async checkAvailability() { return false; }
    getSetupMessage() { return null; }
}
