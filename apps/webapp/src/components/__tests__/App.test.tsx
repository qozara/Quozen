import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthenticatedApp } from "../../App";
import { useAuth } from "@/context/auth-provider";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import { useQuery } from "@tanstack/react-query";
import { useAutoSync } from "@/hooks/use-auto-sync";

// Mock hooks
vi.mock("@/context/auth-provider", () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: any) => <div>{children}</div>
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@/hooks/use-groups", () => ({
  useGroups: vi.fn(),
}));

// Mock AutoSync
vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: vi.fn(),
}));

// Mock Provider which is used in App
vi.mock("@/context/auto-sync-context", () => ({
  AutoSyncProvider: ({ children }: any) => <>{children}</>
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    // Mock useQueryClient to avoid "No QueryClient set" error
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
    })),
    QueryClientProvider: ({ children }: any) => <div>{children}</div>,
  };
});

// Mock UI components
vi.mock("@/components/header", () => ({ default: () => <div data-testid="header">Header</div> }));
vi.mock("@/components/bottom-navigation", () => ({ default: () => <div data-testid="bottom-nav">Nav</div> }));
vi.mock("@/components/add-expense-drawer", () => ({ default: () => <div data-testid="add-expense-drawer">Add Drawer</div> }));
vi.mock("@/components/pull-to-refresh", () => ({
  default: ({ children }: any) => <div data-testid="pull-to-refresh">{children}</div>
}));
vi.mock("@/pages/login", () => ({ default: () => <div data-testid="login">Login</div> }));

// Helper mock for Dashboard that consumes context
vi.mock("@/pages/dashboard", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { AppContext } = await vi.importActual<typeof import("@/context/app-context")>("@/context/app-context");

  return {
    default: () => {
      const context = React.useContext(AppContext);
      const activeGroupId = context?.activeGroupId || "none";
      const setActiveGroupId = context?.setActiveGroupId || (() => { });

      return (
        <div data-testid="dashboard">
          <span data-testid="active-group-id">Active: {activeGroupId}</span>
          <button onClick={() => setActiveGroupId("group-2")}>Switch to Group 2</button>
        </div>
      );
    }
  };
});

describe("AuthenticatedApp Integration", () => {
  const mockUpdateActiveGroup = vi.fn();
  const mockUser = { id: "u1", email: "test@example.com" };
  const mockGroups = [
    { id: "group-1", name: "Group 1" },
    { id: "group-2", name: "Group 2" }
  ];
  const mockSettings = {
    activeGroupId: "group-1",
    version: 1,
    groupCache: [{ id: "group-1", name: "Group 1" }, { id: "group-2", name: "Group 2" }]
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (useAuth as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      isLoading: false
    });

    (useSettings as any).mockReturnValue({
      settings: mockSettings,
      isLoading: false,
      updateActiveGroup: mockUpdateActiveGroup
    });

    (useGroups as any).mockReturnValue({
      groups: mockGroups,
      isLoading: false
    });

    (useAutoSync as any).mockReturnValue({
      triggerSync: vi.fn(),
      isEnabled: true,
      isPaused: false
    });

    (useQuery as any).mockReturnValue({
      data: mockGroups,
      isLoading: false
    });
  });

  it("initializes active group from settings", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthenticatedApp />
      </MemoryRouter>
    );

    // Should default to group-1 from settings
    await waitFor(() => expect(screen.getByText(/Active: group-1/)).toBeInTheDocument());
  });

  it("persists selection when active group changes", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <AuthenticatedApp />
      </MemoryRouter>
    );

    // Click button to switch to group-2
    const btn = await screen.findByText("Switch to Group 2");

    // Fix ACT warning: Use fireEvent to wrap the update
    fireEvent.click(btn);

    // 1. Verify local state update
    await waitFor(() => expect(screen.getByTestId("active-group-id")).toHaveTextContent("Active: group-2"));

    // 2. Verify persistence call - NOW SHOULD CALL updateActiveGroup, NOT updateSettings
    expect(mockUpdateActiveGroup).toHaveBeenCalledWith("group-2");
  });
});
