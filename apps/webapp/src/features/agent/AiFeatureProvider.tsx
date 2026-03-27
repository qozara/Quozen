import React, { Suspense, lazy, useEffect, useState, Component, ErrorInfo, ReactNode } from 'react';
import { AiFeatureContext, AiFeatureState } from './AiFeatureContext';
import { AiProviderFactory } from '@quozen/core';
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

    useEffect(() => {
        const checkAvailability = async () => {
            // Step 1: Check build flag
            if (import.meta.env.VITE_DISABLE_AI === 'true') {
                setState({ status: 'unavailable', reason: "Disabled via build configuration" });
                return;
            }

            const providerPreference = settings?.preferences?.aiProvider || 'auto';
            if (providerPreference === 'disabled') {
                setState({ status: 'unavailable', reason: "Disabled in user settings" });
                return;
            }

            try {
                const config = {
                    providerPreference: providerPreference as any,
                    encryptedApiKey: settings?.encryptedApiKey,
                    baseUrl: settings?.preferences?.ollamaBaseUrl || (import.meta as any).env.VITE_OLLAMA_URL || 'http://localhost:11434/api',
                    proxyUrl: (import.meta as any).env.VITE_AI_PROXY_URL,
                    ollamaModel: settings?.preferences?.ollamaModel || (import.meta as any).env.VITE_OLLAMA_MODEL || 'qwen2.5:0.5b',
                    byokProvider: settings?.preferences?.byokProvider || 'google'
                };

                const provider = await AiProviderFactory.createProvider(config, getAuthToken);
                const isAvailable = await provider.checkAvailability();

                if (isAvailable) {
                    setState({ status: 'available', provider });
                } else {
                    const reason = `Provider ${provider.id} unreachable`;
                    setState({ status: 'unavailable', reason });
                    console.info("[Agentic UI] Disabled:", reason);
                }
            } catch (error: any) {
                const reason = error.message || "Initialization error";
                setState({ status: 'unavailable', reason });
                console.info("[Agentic UI] Disabled:", reason);
            }
        };

        if (!settingsLoading) {
            checkAvailability();
        }
    }, [settings, settingsLoading]);

    const handleModuleError = () => {
        setState({ status: 'unavailable', reason: "Module load failure" });
    };

    return (
        <AiFeatureContext.Provider value={state}>
            {children}
            {state.status === 'available' && (
                <AiErrorBoundary onCatch={handleModuleError}>
                    <Suspense fallback={null}>
                        <AgentModule />
                    </Suspense>
                </AiErrorBoundary>
            )}
        </AiFeatureContext.Provider>
    );
};
