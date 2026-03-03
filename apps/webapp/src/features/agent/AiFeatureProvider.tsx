import React, { Suspense, lazy, useEffect, useState, Component, ErrorInfo, ReactNode } from 'react';
import { AiFeatureContext, AiFeatureState } from './AiFeatureContext';

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

    useEffect(() => {
        const checkAvailability = async () => {
            // Step 1: Check build flag
            if (import.meta.env.VITE_DISABLE_AI === 'true') {
                const reason = "Disabled via build configuration";
                setState({ status: 'unavailable', reason });
                console.info("[Agentic UI] Disabled:", reason);
                return;
            }

            // Step 2: Check env var
            const proxyUrl = import.meta.env.VITE_AI_PROXY_URL;
            if (!proxyUrl) {
                const reason = "Missing proxy URL in environment";
                setState({ status: 'unavailable', reason });
                console.info("[Agentic UI] Disabled:", reason);
                return;
            }

            // Step 3: Perform fetch with timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            try {
                const response = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok) {
                    setState({ status: 'available' });
                } else {
                    const errorText = await response.text();
                    console.warn(`[Agentic UI] Proxy check failed: ${response.status} ${errorText}`);
                    throw new Error(`Proxy returned ${response.status} status`);
                }
            } catch (error) {
                clearTimeout(timeoutId);
                const reason = "Proxy unreachable or timeout";
                setState({ status: 'unavailable', reason });
                console.info("[Agentic UI] Disabled:", reason);
            }
        };

        checkAvailability();
    }, []);

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
