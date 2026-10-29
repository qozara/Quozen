import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Groups from "../groups";
import { useAppContext } from "@/context/app-context";
import { useAuth } from "@/context/auth-provider";
import { useQuery, useMutation } from "@tanstack/react-query";
import { quozen } from "@/lib/storage";
import { useSettings } from "@/hooks/use-settings";
import { useGroups } from "@/hooks/use-groups";
import { useAutoSync } from "@/hooks/use-auto-sync";
import en from "@/locales/en/translation.json";
import { GroupFileUnavailableError } from "@quozen/core";

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
    replication: {
      sync: vi.fn().mockResolvedValue(undefined)
    },
    groups: {
      importGroup: vi.fn(),
      create: vi.fn(),
      updateGroup: vi.fn(),
      deleteGroup: vi.fn(),
      leaveGroup: vi.fn(),
      archiveGroup: vi.fn(),
      unarchiveGroup: vi.fn()
    },
    ledger: vi.fn(() => ({ getMembers: vi.fn() }))
  }
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick, ...props }: any) => <div onClick={onClick} role="menuitem" {...props}>{children}</div>,
}));

vi.mock("@/components/ui/tabs", () => {
  const React = require("react");
  const TabsContext = React.createContext({ activeValue: "active", onValueChange: (_val: string) => {} });

  return {
    Tabs: ({ children, value, onValueChange, className }: any) => (
      <TabsContext.Provider value={{ activeValue: value, onValueChange }}>
        <div className={className} data-value={value}>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children, className }: any) => (
      <div className={className} role="tablist">{children}</div>
    ),
    TabsTrigger: ({ children, value, className, onClick, ...props }: any) => {
      const { activeValue, onValueChange } = React.useContext(TabsContext);
      return (
        <button
          type="button"
          role="tab"
          className={className}
          data-state={value === activeValue ? "active" : "inactive"}
          onClick={(e) => {
            onValueChange?.(value);
            onClick?.(e);
          }}
          {...props}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value, className }: any) => {
      const { activeValue } = React.useContext(TabsContext);
      if (value !== activeValue) return null;
      return <div className={className} data-state="active">{children}</div>;
    }
  };
});

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
      archivedGroups: [],
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

  it("renders group cards with custom group icons", async () => {
    (useGroups as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      groups: [
        {
          id: "group1",
          name: "Trip to Paris",
          description: "Summer vacation",
          createdBy: "me",
          participants: ["user1", "user2"],
          createdAt: new Date().toISOString(),
          isOwner: true,
          icon: "preset:plane"
        }
      ],
      isLoading: false
    });

    const { container } = render(<Groups />);
    expect(screen.getByText("Trip to Paris")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-plane")).toBeInTheDocument();
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

  it("opens edit group dialog immediately when members are already in local storage", async () => {
    (quozen.ledger as any).mockReturnValue({
      getMembers: vi.fn().mockResolvedValue(mockGroup1Data.members)
    });

    render(<Groups />);
    const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
    const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
    fireEvent.click(meatball);

    const editBtn = screen.getByText(en.common.edit);
    fireEvent.click(editBtn);

    // Dialog should open with members loaded from local ledger
    await waitFor(() => expect(screen.getByText(en.groups.edit)).toBeInTheDocument());
    expect(screen.getByDisplayValue("Trip to Paris")).toBeInTheDocument();
  });

  it("does not trigger remote replication.sync when opening edit dialog if members are already cached locally", async () => {
    (quozen.ledger as any).mockReturnValue({
      getMembers: vi.fn().mockResolvedValue(mockGroup1Data.members)
    });
    ((quozen.replication as any).sync as any).mockClear();

    render(<Groups />);
    const editBtn = screen.getByText(en.common.edit);
    fireEvent.click(editBtn);

    await waitFor(() => expect(screen.getByText(en.groups.edit)).toBeInTheDocument());
    expect((quozen.replication as any).sync).not.toHaveBeenCalled();
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

  it("displays reassurance message when leaving a group with a co-managed shared account", async () => {
    (useSettings as any).mockReturnValue({
      settings: {
        activeGroupId: "group2",
        groupCache: [
          { id: "group2", name: "Office Lunch", role: "member", accountId: "acc-shared-garcia" }
        ]
      }
    });

    render(<Groups />);
    const group2Card = screen.getByText("Office Lunch").closest('[data-testid="group-card"]');
    const meatball = within(group2Card as HTMLElement).getByTestId("group-menu-trigger");
    fireEvent.click(meatball);

    const leaveBtn = screen.getByText(en.groups.leaveAction);
    fireEvent.click(leaveBtn);

    await waitFor(() => {
      expect(screen.getByText(en.groups.leave)).toBeInTheDocument();
      expect(screen.getByText(/acc-shared-garcia.*will remain in the group/i)).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole("button", { name: en.groups.leaveAction });
    fireEvent.click(confirmBtn);

    expect(quozen.groups.leaveGroup).toHaveBeenCalledWith("group2");
  });

  describe("Offline mode handling", () => {
    beforeEach(() => {
      (useAutoSync as any).mockReturnValue({ isOnline: false, setPaused: vi.fn() });
    });

    it("shows OnlineRequiredDialog when clicking New Group while offline", async () => {
      render(<Groups />);
      const newGroupBtn = screen.getByTestId("button-new-group");
      fireEvent.click(newGroupBtn);
      expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
      expect(screen.getByText(en.offline.reasons.createGroup)).toBeInTheDocument();

      const confirmBtn = screen.getByTestId("online-required-confirm");
      fireEvent.click(confirmBtn);
      expect(screen.queryByTestId("online-required-dialog")).not.toBeInTheDocument();
    });

    it("shows OnlineRequiredDialog when clicking Delete while offline", async () => {
      render(<Groups />);
      const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
      const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const deleteBtn = screen.getByText(en.common.delete);
      fireEvent.click(deleteBtn);
      expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
      expect(screen.getByText(en.offline.reasons.deleteGroup)).toBeInTheDocument();
    });

    it("shows OnlineRequiredDialog when clicking Leave while offline", async () => {
      render(<Groups />);
      const group2Card = screen.getByText("Office Lunch").closest('[data-testid="group-card"]');
      const meatball = within(group2Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const leaveBtn = screen.getByText(en.groups.leaveAction);
      fireEvent.click(leaveBtn);
      expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
      expect(screen.getByText(en.offline.reasons.leaveGroup)).toBeInTheDocument();
    });

    it("shows OnlineRequiredDialog when clicking Find in Google Drive while offline", async () => {
      render(<Groups />);
      const findInDriveBtn = screen.getByText(en.groups.findInDrive);
      fireEvent.click(findInDriveBtn);
      expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
      expect(screen.getByText(en.offline.reasons.importDrive)).toBeInTheDocument();
    });

    it("shows OnlineRequiredDialog when editing an unhydrated group while offline", async () => {
      (quozen.ledger as any).mockReturnValue({
        getMembers: vi.fn().mockResolvedValue([])
      });

      render(<Groups />);
      const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
      const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const editBtn = screen.getByText(en.common.edit);
      fireEvent.click(editBtn);

      await waitFor(() => {
        expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
        expect(screen.getByText(en.offline.reasons.editUnhydratedGroup)).toBeInTheDocument();
      });
    });

    it("shows OnlineRequiredDialog when inviting new email member while offline", async () => {
      (quozen.ledger as any).mockReturnValue({
        getMembers: vi.fn().mockResolvedValue(mockGroup1Data.members)
      });

      render(<Groups />);
      const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
      const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const editBtn = screen.getByText(en.common.edit);
      fireEvent.click(editBtn);

      await waitFor(() => expect(screen.getByText(en.groups.edit)).toBeInTheDocument());
      await screen.findByText("bob@example.com");

      const input = screen.getByPlaceholderText(en.groups.membersHint);
      fireEvent.change(input, { target: { value: "charlie@example.com" } });
      const addBtn = input.parentElement?.querySelector('button');
      expect(addBtn).toBeInTheDocument();
      fireEvent.click(addBtn!);

      await screen.findByText("charlie@example.com");

      const updateBtn = screen.getByRole("button", { name: en.groups.update });
      fireEvent.click(updateBtn);

      await waitFor(() => {
        const dialog = screen.getByTestId("online-required-dialog");
        expect(dialog).toBeInTheDocument();
        expect(within(dialog).getByText(/charlie@example\.com/)).toBeInTheDocument();
      });
    });
  });

  describe("Archive & Unarchive Groups", () => {
    it("renders tabs for Active and Archived groups", () => {
      render(<Groups />);
      expect(screen.getByTestId("tab-active-groups")).toBeInTheDocument();
      expect(screen.getByTestId("tab-archived-groups")).toBeInTheDocument();
      expect(screen.getByTestId("tab-active-groups")).toHaveTextContent(`${en.groups.tabs.active} (2)`);
      expect(screen.getByTestId("tab-archived-groups")).toHaveTextContent(`${en.groups.tabs.archived} (0)`);
    });

    it("shows Archive option in dropdown for both owner and member groups", () => {
      render(<Groups />);
      const archiveMenuItems = screen.getAllByTestId("menuitem-archive");
      expect(archiveMenuItems.length).toBe(2);
      expect(screen.getAllByText(en.groups.archiveAction).length).toBeGreaterThanOrEqual(2);
    });

    it("opens archive confirmation dialog and calls archiveGroup on confirm", async () => {
      (quozen.groups.archiveGroup as any).mockResolvedValueOnce(undefined);

      render(<Groups />);
      const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
      const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const archiveBtn = within(group1Card as HTMLElement).getByTestId("menuitem-archive");
      fireEvent.click(archiveBtn);

      await waitFor(() => {
        expect(screen.getByText(en.groups.archive)).toBeInTheDocument();
      });

      const confirmBtn = screen.getByTestId("alert-action-confirm");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(quozen.groups.archiveGroup).toHaveBeenCalledWith("group1");
      });
    });

    it("shows empty state when switching to Archived tab with no archived groups", () => {
      render(<Groups />);
      const archivedTab = screen.getByTestId("tab-archived-groups");
      fireEvent.pointerDown(archivedTab, { button: 0 });
      fireEvent.click(archivedTab);

      expect(screen.getByText(en.groups.noArchived)).toBeInTheDocument();
    });

    it("renders archived groups with Unarchive button and handles unarchive", async () => {
      const archivedGroup = {
        id: "archived-1",
        name: "Old Trip 2024",
        description: "Archived Group",
        createdBy: "Unknown",
        participants: [],
        createdAt: new Date(),
        isOwner: true,
      };

      (useGroups as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        groups: [mockGroups[0]],
        archivedGroups: [archivedGroup],
        isLoading: false,
      });

      (quozen.groups.unarchiveGroup as any).mockResolvedValueOnce(undefined);

      render(<Groups />);
      const archivedTab = screen.getByTestId("tab-archived-groups");
      fireEvent.pointerDown(archivedTab, { button: 0 });
      fireEvent.click(archivedTab);

      expect(screen.getByText("Old Trip 2024")).toBeInTheDocument();
      expect(screen.getByText(en.groups.tabs.archived)).toBeInTheDocument();

      const unarchiveBtn = screen.getByTestId("button-unarchive");
      fireEvent.click(unarchiveBtn);

      await waitFor(() => {
        expect(quozen.groups.unarchiveGroup).toHaveBeenCalledWith("archived-1");
      });
    });

    it("shows toast when archiving a file that was trashed/deleted in Google Drive", async () => {
      (quozen.groups.archiveGroup as any).mockRejectedValueOnce(
        new GroupFileUnavailableError("group1", "Trip to Paris", "trashed")
      );

      render(<Groups />);
      const group1Card = screen.getByText("Trip to Paris").closest('[data-testid="group-card"]');
      const meatball = within(group1Card as HTMLElement).getByTestId("group-menu-trigger");
      fireEvent.click(meatball);

      const archiveBtn = within(group1Card as HTMLElement).getByTestId("menuitem-archive");
      fireEvent.click(archiveBtn);

      await waitFor(() => {
        expect(screen.getByText(en.groups.archive)).toBeInTheDocument();
      });

      const confirmBtn = screen.getByTestId("alert-action-confirm");
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: en.groups.fileUnavailableTitle,
            variant: "destructive"
          })
        );
      });
    });
  });
});
