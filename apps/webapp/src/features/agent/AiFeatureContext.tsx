import { createContext, useContext } from 'react';
import type { AiProvider } from '@quozen/ai-services';

export type AiAvailabilityStatus = 'checking' | 'available' | 'unavailable';

export interface AiFeatureState {
    status: AiAvailabilityStatus;
    reason?: string;
    provider?: AiProvider;
    getOrResolveProvider?: () => Promise<AiProvider | null>;
}

export const AiFeatureContext = createContext<AiFeatureState | undefined>(undefined);

export const useAiFeature = () => {
    const context = useContext(AiFeatureContext);
    if (context === undefined) {
        throw new Error('useAiFeature must be used within an AiFeatureProvider');
    }
    return context;
};
