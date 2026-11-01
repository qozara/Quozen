import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Profile from "../profile";
import { useAuth } from "@/context/auth-provider";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import { ThemeProvider } from "@/context/theme-context";

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
  useAiFeature: vi.fn(() => ({
    status: "available",
    provider: "auto",
  })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-pwa-update", () => ({
  usePwaUpdate: vi.fn(() => ({
    needRefresh: false,
    isChecking: false,
    checkForUpdates: vi.fn(),
    applyUpdate: vi.fn(),
  })),
}));

vi.mock("@/lib/storage", () => ({
  quozen: {
    groups: {
      reconcileGroups: vi.fn(),
    },
  },
}));

describe("Profile Page Theme Integration", () => {
  const mockUser = {
    id: "user1",
    name: "Alice Smith",
    email: "alice@example.com",
    username: "alicesmith",
    picture: "http://example.com/pic.jpg",
  };

  let mockUpdateSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdateSettings = vi.fn();
    (useAuth as any).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      logout: vi.fn(),
    });

    (useGroups as any).mockReturnValue({
      groups: [],
      isLoading: false,
    });

    (useSettings as any).mockReturnValue({
      settings: {
        activeGroupId: "group1",
        version: 1,
        preferences: {
          defaultCurrency: "USD",
          theme: "system",
        },
      },
      updateSettings: mockUpdateSettings,
    });

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("renders theme selection with system as default", () => {
    render(
      <ThemeProvider>
        <Profile />
      </ThemeProvider>
    );

    expect(screen.getByTestId("theme-option-system")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-option-dark")).toBeInTheDocument();

    const systemBtn = screen.getByTestId("theme-option-system");
    expect(systemBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("changes theme immediately on click and persists to settings", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <Profile />
      </ThemeProvider>
    );

    const darkBtn = screen.getByTestId("theme-option-dark");
    await user.click(darkBtn);

    expect(darkBtn).toHaveAttribute("aria-pressed", "true");
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          theme: "dark",
        }),
      })
    );
  });
});
