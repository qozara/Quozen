import React, { Suspense, lazy, useEffect, useState, Component, ErrorInfo, ReactNode, useRef, useCallback, useMemo } from 'react';
import { AiFeatureContext, AiFeatureState } from './AiFeatureContext';
import { AiProviderFactory, AiProvider } from '@quozen/core';
import { useSettings } from '@/hooks/use-settings';
import { getAuthToken } from '@/lib/tokenStore';

const AgentModule = lazy(() => import('@/features/agent/AgentModule'));

interface ErrorBoundaryProps {
    children: ReactNode;
    onCatch: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class AiErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.props.onCatch(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return null;
        }
        return this.props.children;
    }
}

export const AiFeatureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, setState] = useState<AiFeatureState>({ status: 'checking' });
    const { settings, isLoading: settingsLoading } = useSettings();

    const aiProvider = settings?.preferences?.aiProvider;
    const enableLocalAi = settings?.preferences?.enableLocalAi ?? false;
    const encryptedApiKey = settings?.encryptedApiKey;
    const ollamaBaseUrl = settings?.preferences?.ollamaBaseUrl;
    const ollamaModel = settings?.preferences?.ollamaModel;
    const byokProvider = settings?.preferences?.byokProvider;

    const resolvedProviderRef = useRef<AiProvider | null>(null);

    // Reset cached provider when AI settings change
    useEffect(() => {
        resolvedProviderRef.current = null;
    }, [aiProvider, enableLocalAi, encryptedApiKey, ollamaBaseUrl, ollamaModel, byokProvider]);

    // Inspect AI availability (hide/show AI icon) on boot and when AI settings change
    useEffect(() => {
        if (settingsLoading) return;

        // Step 1: Check build flag
        if (import.meta.env.VITE_DISABLE_AI === 'true') {
            setState({ status: 'unavailable', reason: "Disabled via build configuration" });
            return;
        }

        const providerPreference = aiProvider || 'auto';
        if (providerPreference === 'disabled') {
            setState({ status: 'unavailable', reason: "Disabled in user settings" });
            return;
        }

        setState(prev => ({
            ...prev,
            status: 'available',
            provider: resolvedProviderRef.current || undefined
        }));
    }, [aiProvider, enableLocalAi, encryptedApiKey, ollamaBaseUrl, ollamaModel, byokProvider, settingsLoading]);

    const getOrResolveProvider = useCallback(async (): Promise<AiProvider | null> => {
        if (resolvedProviderRef.current) {
            return resolvedProviderRef.current;
        }

        const providerPreference = aiProvider || 'auto';
        if (providerPreference === 'disabled' || import.meta.env.VITE_DISABLE_AI === 'true') {
            return null;
        }

        try {
            const config = {
                providerPreference: providerPreference as any,
                enableLocalAi,
                encryptedApiKey,
                baseUrl: enableLocalAi ? (ollamaBaseUrl || (import.meta as any).env.VITE_OLLAMA_URL || 'http://localhost:11434/api') : undefined,
                proxyUrl: (import.meta as any).env.VITE_AI_PROXY_URL,
                ollamaModel: ollamaModel || (import.meta as any).env.VITE_OLLAMA_MODEL || 'qwen2.5:0.5b',
                byokProvider: byokProvider || 'google'
            };

            const provider = await AiProviderFactory.createProvider(config, getAuthToken);
            const isAvailable = await provider.checkAvailability();

            if (isAvailable) {
                resolvedProviderRef.current = provider;
                setState(prev => ({ ...prev, provider }));
                return provider;
            } else {
                console.info("[Agentic UI] Provider unreachable:", provider.id);
                return null;
            }
        } catch (error: any) {
            console.error("[Agentic UI] Error resolving provider:", error);
            return null;
        }
    }, [aiProvider, encryptedApiKey, ollamaBaseUrl, ollamaModel, byokProvider]);

    const handleModuleError = () => {
        setState({ status: 'unavailable', reason: "Module load failure" });
    };

    const contextValue = useMemo<AiFeatureState>(() => ({
        ...state,
        getOrResolveProvider
    }), [state, getOrResolveProvider]);

    return (
        <AiFeatureContext.Provider value={contextValue}>
            {children}
            <AiErrorBoundary onCatch={handleModuleError}>
                <Suspense fallback={null}>
                    <AgentModule />
                </Suspense>
            </AiErrorBoundary>
        </AiFeatureContext.Provider>
    );
};
