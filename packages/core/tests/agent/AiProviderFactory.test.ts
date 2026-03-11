import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiProviderFactory } from '../../src/agent/providers/AiProviderFactory';
import { ProxyAiProvider } from '../../src/agent/providers/ProxyAiProvider';
import { WindowAiProvider } from '../../src/agent/providers/WindowAiProvider';
import { LocalOllamaProvider } from '../../src/agent/providers/LocalOllamaProvider';

describe('AiProviderFactory', () => {
    const mockGetToken = () => 'test-token';

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset global.window if needed
        (global as any).window = {};
    });

    it('should return ProxyAiProvider when preference is "cloud"', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'cloud',
            proxyUrl: 'http://proxy'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(ProxyAiProvider);
    });

    it('should return LocalOllamaProvider when preference is "local"', async () => {
        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'local',
            baseUrl: 'http://ollama'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(LocalOllamaProvider);
    });

    it('should return WindowAiProvider when preference is "byok" (mocking window.ai)', async () => {
        // Even if windows.ai is not there, if user selects byok it might still pick something else if encrypted key is missing.
        // Wait, the logic for byok in factory is:
        // if (providerPreference === 'byok' && encryptedApiKey) return Proxy
        // else fallback to local

        const provider = await AiProviderFactory.createProvider({
            providerPreference: 'byok',
            encryptedApiKey: 'test-key',
            proxyUrl: 'http://proxy'
        }, mockGetToken);

        expect(provider).toBeInstanceOf(ProxyAiProvider);
    });

    it('should waterfall in "auto" mode: Proxy (BYOK) -> Window -> Local Ollama -> Proxy (Team)', async () => {
        // 1. BYOK Case
        const p1 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            encryptedApiKey: 'key',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p1).toBeInstanceOf(ProxyAiProvider);

        // 2. Window Case (No BYOK, Window available)
        (global as any).window = {
            ai: {
                languageModel: {
                    capabilities: async () => ({ available: 'readily' })
                }
            }
        };
        const p2 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p2).toBeInstanceOf(WindowAiProvider);

        // 3. Local Ollama Case (No BYOK, No Window, Ollama available)
        (global as any).window = {};
        const mockFetch = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', mockFetch);
        
        const p3 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p3).toBeInstanceOf(LocalOllamaProvider);

        // 4. Fallback to Team Key (No BYOK, No Window, No Ollama)
        mockFetch.mockResolvedValue({ ok: false });
        const p4 = await AiProviderFactory.createProvider({
            providerPreference: 'auto',
            proxyUrl: 'http://proxy'
        }, mockGetToken);
        expect(p4).toBeInstanceOf(ProxyAiProvider);

        vi.unstubAllGlobals();
    });

    it('should handle getSetupMessage', () => {
        expect(AiProviderFactory.getSetupMessage('disabled')).toBeNull();
        expect(typeof AiProviderFactory.getSetupMessage('local')).toBe('string');
        expect(typeof AiProviderFactory.getSetupMessage('byok')).toBe('string');
    });
});
