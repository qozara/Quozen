import { createOllama } from 'ollama-ai-provider';
import { AiProvider, ProviderConfig } from './types';
import { LanguageModel } from 'ai';

export class OllamaProvider implements AiProvider {
    readonly id = 'ollama';
    readonly isCloud = false;

    getLanguageModel(config: ProviderConfig): LanguageModel {
        const ollama = createOllama({
            baseURL: config.baseUrl || 'http://localhost:11434/api',
        });
        return ollama(config.model);
    }

    validateConfig(_config: ProviderConfig): { isValid: boolean; error?: string } {
        // No specific key for ollama.
        return { isValid: true };
    }

    getTeamConfig(bindings: any): ProviderConfig {
        return {
            baseUrl: bindings.OLLAMA_BASE_URL || 'http://localhost:11434/api',
            model: bindings.GOOGLE_GENERATIVE_AI_MODEL || 'llama3.2'
        };
    }
}
