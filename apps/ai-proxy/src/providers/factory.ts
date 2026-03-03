import { AiProvider } from './types';
import { GoogleProvider } from './google';
import { OllamaProvider } from './ollama';

const providers: Record<string, AiProvider> = {
    google: new GoogleProvider(),
    ollama: new OllamaProvider(),
};

/**
 * Registry for AI Providers. New providers can be added here without touching the main business logic.
 */
export const ProviderFactory = {
    getProvider(id: string): AiProvider | undefined {
        return providers[id];
    },

    listProviders(): string[] {
        return Object.keys(providers);
    }
};
