import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Header from "../header";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/context/app-context", () => ({
    useAppContext: () => ({
        activeGroupId: "group-1",
        currentUserId: "user-1"
    })
}));

vi.mock("@/hooks/use-groups", () => ({
    useGroups: () => ({
        groups: [
            {
                id: "group-1",
                name: "Euro Trip 2026",
                role: "owner",
                icon: "preset:plane"
            }
        ],
        isLoading: false
    })
}));

vi.mock("@/lib/storage", () => ({
    quozen: {
        ledger: () => ({
            getLedger: vi.fn().mockResolvedValue({
                members: [{ userId: "user-1", name: "Alice" }, { userId: "user-2", name: "Bob" }]
            })
        })
    }
}));

vi.mock("@/hooks/use-auto-sync", () => ({
    useAutoSync: () => ({
        isEnabled: true,
        setPaused: vi.fn(),
        isOnline: true,
        syncStatus: "idle",
        lastSyncTime: null,
        triggerSync: vi.fn()
    })
}));

describe("Header Component with Group Icon & Hero Banner", () => {
    const queryClient = new QueryClient();

    const renderHeader = (initialRoute = "/") => {
        return render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[initialRoute]}>
                    <Header />
                </MemoryRouter>
            </QueryClientProvider>
        );
    };

    it("renders group name and active group indicator on main screens", () => {
        renderHeader("/");
        expect(screen.getByText("Euro Trip 2026")).toBeInTheDocument();
        expect(screen.getByTestId("active-group-badge")).toBeInTheDocument();
    });

    it("renders blurred hero banner when active group has an icon", () => {
        renderHeader("/");
        expect(screen.getByTestId("hero-blurred-banner")).toBeInTheDocument();
    });

    it("renders group icon inside the header avatar", () => {
        const { container } = renderHeader("/");
        expect(container.querySelector("[data-testid='header']")).toBeInTheDocument();
        // The plane preset icon SVG should be rendered
        expect(container.querySelector("svg.lucide-plane")).toBeInTheDocument();
    });

    it("renders blurred preset icon watermark graphic in hero banner when preset icon is active", () => {
        renderHeader("/");
        expect(screen.getByTestId("hero-blurred-preset-icon")).toBeInTheDocument();
    });

    it("does not have overflow-hidden on header so popovers and sync status trigger are not clipped", () => {
        renderHeader("/");
        const header = screen.getByTestId("header");
        expect(header.className).not.toContain("overflow-hidden");
    });

    it("renders member count fallback when participantsData is not in cache", async () => {
        renderHeader("/");
        const countEl = await screen.findByTestId("text-participant-count");
        expect(countEl).toHaveTextContent("2 people");
    });

    it("renders collaborator count when participantsData is available in cache without making Google API calls", async () => {
        const clientWithCache = new QueryClient();
        clientWithCache.setQueryData(["group-participants", "group-1"], {
            collaborators: [
                { id: "c1", email: "alice@example.com", displayName: "Alice", role: "owner" },
                { id: "c2", email: "bob@example.com", displayName: "Bob", role: "editor" },
                { id: "c3", email: "charlie@example.com", displayName: "Charlie", role: "editor" },
                { id: "c4", email: "david@example.com", displayName: "David", role: "viewer" },
                { id: "c5", email: "elena@example.com", displayName: "Elena", role: "editor" }
            ],
            accounts: [],
            unassignedCollaborators: []
        });

        render(
            <QueryClientProvider client={clientWithCache}>
                <MemoryRouter initialEntries={["/"]}>
                    <Header />
                </MemoryRouter>
            </QueryClientProvider>
        );

        const countEl = await screen.findByTestId("text-participant-count");
        expect(countEl).toHaveTextContent("5 people");
    });
});
