import React from "react";
import { renderHook, act, render, screen } from "@testing-library/react";
import { AiFeatureProvider } from "../AiFeatureProvider";
import { useAiFeature } from "../AiFeatureContext";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { AiProviderFactory } from "@quozen/core";

// Mock AiProviderFactory
vi.mock("@quozen/core", () => ({
    AiProviderFactory: {
        createProvider: vi.fn(),
        getSetupMessage: vi.fn(),
    },
    QuozenAI: vi.fn().mockImplementation(function (this: any) {
        this.executeCommand = vi.fn().mockResolvedValue({ success: true, message: 'Done' });
        return this;
    }),
}));

let mockSettings: any = {
    preferences: { aiProvider: 'auto' },
    activeGroupId: 'g1'
};
let mockLoading = false;

vi.mock("@/hooks/use-settings", () => ({
    useSettings: () => ({
        settings: mockSettings,
        isLoading: mockLoading,
    }),
}));

vi.mock("@/lib/tokenStore", () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

vi.mock("@/features/agent/AgentModule", () => ({
    default: () => <div data-testid="agent-module">AgentModule</div>,
}));

describe("AiFeatureProvider", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSettings = {
            preferences: { aiProvider: 'auto' },
            activeGroupId: 'g1'
        };
        mockLoading = false;
    });

    it("makes AI available on initial boot without eagerly calling createProvider", async () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <AiFeatureProvider>{children}</AiFeatureProvider>
        );

        const { result } = renderHook(() => useAiFeature(), { wrapper });

        expect(result.current.status).toBe("available");
        // Must NOT eagerly call createProvider on boot
        expect(AiProviderFactory.createProvider).not.toHaveBeenCalled();
    });

    it("does not re-probe when activeGroupId or unrelated settings change", async () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <AiFeatureProvider>{children}</AiFeatureProvider>
        );

        const { result, rerender } = renderHook(() => useAiFeature(), { wrapper });

        expect(result.current.status).toBe("available");

        // Simulate group switch
        mockSettings = {
            ...mockSettings,
            activeGroupId: 'g2',
            groupCache: [{ id: 'g2', name: 'Group 2' }]
        };

        rerender();

        expect(result.current.status).toBe("available");
        expect(AiProviderFactory.createProvider).not.toHaveBeenCalled();
    });

    it("resolves provider when getOrResolveProvider is called (action button pressed)", async () => {
        const mockProvider = {
            id: 'cloud',
            mode: 'cloud',
            checkAvailability: vi.fn().mockResolvedValue(true)
        };
        (AiProviderFactory.createProvider as any).mockResolvedValue(mockProvider);

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <AiFeatureProvider>{children}</AiFeatureProvider>
        );

        const { result } = renderHook(() => useAiFeature(), { wrapper });

        expect(result.current.status).toBe("available");
        expect(result.current.provider).toBeUndefined();

        let resolved: any;
        await act(async () => {
            resolved = await result.current.getOrResolveProvider?.();
        });

        expect(AiProviderFactory.createProvider).toHaveBeenCalledTimes(1);
        expect(resolved).toBe(mockProvider);
        expect(result.current.provider).toBe(mockProvider);
    });
});
