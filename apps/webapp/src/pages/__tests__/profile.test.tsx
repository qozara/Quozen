import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Profile from "../profile";
import { useAuth } from "@/context/auth-provider";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import en from "@/locales/en/translation.json";
import { useAiFeature } from "@/features/agent/AiFeatureContext";

// Mock hooks
vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(),
}));

vi.mock("@/context/auth-provider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: vi.fn(),
}));

vi.mock("@/hooks/use-groups", () => ({
  useGroups: vi.fn(),
}));

vi.mock("@/features/agent/AiFeatureContext", () => ({
  useAiFeature: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    })),
  };
});

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/lib/storage", () => ({
  quozen: {
    groups: {
      reconcileGroups: vi.fn()
    }
  }
}));

describe("Profile Page", () => {
  const mockUser = {
    id: "user1",
    name: "Alice Smith",
    email: "alice@example.com",
    username: "alicesmith",
    picture: "http://example.com/pic.jpg"
  };

  const mockGroups = [
    { id: "group1", name: "Trip 1" },
    { id: "group2", name: "Trip 2" },
    { id: "group3", name: "Trip 3" },
  ];

  const mockLogout = vi.fn();
  const mockUpdateSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: mockUser,
      logout: mockLogout,
    });

    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: {
        preferences: { defaultCurrency: "USD" },
        groupCache: mockGroups.map(g => ({ id: g.id, name: g.name, role: 'owner' }))
      },
      updateSettings: mockUpdateSettings,
    });

    (useGroups as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      groups: mockGroups,
      isLoading: false
    });

    (useAiFeature as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'available'
    });
  });

  it("renders user profile information", () => {
    render(<Profile />);

    expect(screen.getByTestId("text-user-name")).toHaveTextContent("Alice Smith");
    expect(screen.getByTestId("text-user-email")).toHaveTextContent("alice@example.com");
  });

  it("displays correct statistics", () => {
    render(<Profile />);

    expect(screen.getByTestId("text-group-count")).toHaveTextContent("3");
    expect(screen.getByText(en.profile.activeGroups)).toBeInTheDocument();
  });

  it("triggers logout when Sign Out is clicked", () => {
    render(<Profile />);

    const signOutBtn = screen.getByTestId("button-sign-out");
    fireEvent.click(signOutBtn);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("allows forcing re-login (troubleshooting)", () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: vi.fn() },
    });

    render(<Profile />);

    const forceLoginBtn = screen.getByText(en.profile.forceLogin);
    fireEvent.click(forceLoginBtn);

    expect(window.location.reload).toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });
});
