import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Groups from "../groups";
import { useAppContext } from "@/context/app-context";
import { useAuth } from "@/context/auth-provider";
import { useQuery, useMutation } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import en from "@/locales/en/translation.json";

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

// Mock AutoSync
vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: vi.fn(() => ({
    setPaused: vi.fn()
  })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useQueryClient: vi.fn(() => ({
      invalidateQueries: vi.fn(),
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
      importGroup: vi.fn(),
      create: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      leaveGroup: vi.fn()
    },
    ledger: vi.fn(() => ({ getMembers: vi.fn() }))
  }
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: any) => <div onClick={onClick} role="menuitem">{children}</div>,
}));

describe("Groups Page", () => {
  const mockUser = { id: "user1", name: "Alice", email: "alice@example.com" };
  const mockGroups = [
    {
      id: "group1",
      name: "Trip to Paris",
      description: "Summer vacation",
      createdBy: "me",
      participants: ["user1", "user2"],
      createdAt: new Date().toISOString(),
      isOwner: true,
    },
    {
      id: "group2",
      name: "Office Lunch",
      description: "Work stuff",
      createdBy: "Boss",
      participants: ["user1", "user3"],
      createdAt: new Date().toISOString(),
      isOwner: false,
    }
  ];

  const mockGroup1Data = {
    members: [
      { userId: "user1", role: "owner", name: "Alice", email: "alice@example.com" },
      { userId: "user2", role: "member", name: "Bob", email: "bob@example.com" }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeGroupId: "group1",
      setActiveGroupId: vi.fn(),
      currentUserId: "user1",
    });
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });
    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: {
        groupCache: mockGroups.map(g => ({ id: g.id, name: g.name, role: g.isOwner ? 'owner' : 'member' })),
        activeGroupId: "group1"
      },
      updateSettings: vi.fn()
    });
    (useGroups as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      groups: mockGroups,
      isLoading: false
    });
    (useQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });
    (useMutation as unknown as ReturnType<typeof vi.fn>).mockImplementation((options) => ({
      mutate: async (data: any) => {
        try {
          let res;
          if (options?.mutationFn) res = await options.mutationFn(data);
          if (options?.onSuccess) options.onSuccess(res, data);
        } catch (e: any) {
          if (options?.onError) options.onError(e, data);
        }
      },
      isPending: false,
    }));
    // Mock navigator.vibrate
    global.navigator.vibrate = vi.fn();
  });

  it("renders the list of groups with correct badges", () => {
    render(<Groups />);
    expect(screen.getByText(en.groups.title)).toBeInTheDocument();

    const group1Card = screen.getByText("Trip to Paris").closest('.rounded-lg');
    expect(group1Card).toHaveTextContent(en.roles.owner);

    const group2Card = screen.getByText("Office Lunch").closest('.rounded-lg');
    expect(group2Card).toHaveTextContent(en.roles.member);
  });

  it("shows Edit/Delete for owners and Leave for members", async () => {
    render(<Groups />);
    const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
    const meatball1 = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
    expect(meatball1).toBeInTheDocument();

    // For Mocked Dropdown, items are always in document
    expect(screen.getByText(en.common.share)).toBeInTheDocument();
    expect(screen.getByText(en.common.edit)).toBeInTheDocument();
    expect(screen.getByText(en.common.delete)).toBeInTheDocument();

    const group2Card = screen.getByText("Office Lunch").closest('[data-testid="group-card"]');
    const meatball2 = within(group2Card as HTMLElement).getByTestId("group-menu-trigger");
    expect(meatball2).toBeInTheDocument();
    expect(screen.getByText(en.groups.leaveAction)).toBeInTheDocument();
  });

  it("prevents removing a member with existing expenses during edit", async () => {
        (quozen.ledger as any).mockReturnValue({
      getMembers: vi.fn().mockResolvedValue(mockGroup1Data.members)
    });

    render(<Groups />);

    (quozen.groups.updateGroup as any).mockRejectedValueOnce(new Error("Cannot remove Bob because they have expenses"));

    const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
    const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
    fireEvent.click(meatball);

    const editBtn = screen.getByText(en.common.edit);
    fireEvent.click(editBtn);

    await waitFor(() => expect(screen.getByText(en.groups.edit)).toBeInTheDocument());

    // Find Bob's chip and remove it
    const bobText = await screen.findByText("bob@example.com");
    const bobChip = bobText.closest('.flex');
    const removeBtn = bobChip?.querySelector('button');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn!);

    const saveBtn = screen.getByRole("button", { name: en.groups.update });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: en.common.error,
        description: expect.stringContaining("Cannot remove Bob because they have expenses"),
        variant: "destructive"
      }));
    });
  });

  it("opens delete confirmation and triggers mutation", async () => {
        render(<Groups />);
    const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
    const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
    fireEvent.click(meatball);

    const deleteBtn = screen.getByText(en.common.delete);
    fireEvent.click(deleteBtn);

    const confirmBtn = screen.getByRole("button", { name: en.groups.deleteAction });
    fireEvent.click(confirmBtn);

    expect(quozen.groups.deleteGroup).toHaveBeenCalledWith("group1");
    await waitFor(() => expect(screen.queryByText(en.groups.delete)).not.toBeInTheDocument());
  });
});
