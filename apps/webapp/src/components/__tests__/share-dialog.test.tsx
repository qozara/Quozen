import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ShareDialog from "../share-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import en from "@/locales/en/translation.json";
import { quozen } from "@/lib/storage";

// Mock hooks
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));

// Mock auth provider to avoid context error
vi.mock("@/context/auth-provider", () => ({
    useAuth: vi.fn(() => ({ user: { name: "Alice", email: "alice@example.com" } })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@tanstack/react-query")>();
    return {
        ...actual,
        useMutation: vi.fn(),
        useQuery: vi.fn(),
        useQueryClient: vi.fn(() => ({
            invalidateQueries: vi.fn(),
            setQueryData: vi.fn(),
        })),
    };
});

// Mock UI components
vi.mock("@/components/ui/switch", () => ({
    Switch: ({ checked, onCheckedChange, disabled }: any) => (
        <button
            data-testid="mock-switch"
            onClick={() => !disabled && onCheckedChange(!checked)}
            aria-checked={checked}
            disabled={disabled}
        >
            Toggle
        </button>
    ),
}));

// Mock API
vi.mock("@/lib/storage", () => ({
    quozen: {
        groups: {
            setGroupPermissions: vi.fn(),
            getGroupPermissions: vi.fn(),
            getGroupParticipants: vi.fn(),
            removeGroupCollaborator: vi.fn(),
            updateGroup: vi.fn()
        }
    }
}));

// Mock clipboard
const mockWriteText = vi.fn();
Object.assign(navigator, {
    clipboard: {
        writeText: mockWriteText,
    },
});

describe("ShareDialog Component", () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        groupId: "group-123",
        groupName: "Test Trip",
    };

    const mockMutate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Default: permissions loaded as restricted
        (useQuery as any).mockReturnValue({
            data: 'restricted',
            isLoading: false
        });

        // Default: Mutation succeeds
        (useMutation as any).mockImplementation((options: any) => ({
            mutate: (data: any) => {
                mockMutate(data);
                // Simulate async success
                setTimeout(() => {
                    if (options.onSuccess) options.onSuccess(data);
                }, 0);
            },
            isPending: false,
        }));
        (quozen.groups.setGroupPermissions as any).mockResolvedValue(undefined);
    });

    it("initializes switch state based on query data (public)", () => {
        (useQuery as any).mockReturnValue({
            data: 'public',
            isLoading: false
        });

        render(<ShareDialog {...defaultProps} />);

        const switchEl = screen.getByTestId("mock-switch");
        expect(switchEl).toHaveAttribute("aria-checked", "true");
    });

    it("toggles permission when switch is clicked", async () => {
        render(<ShareDialog {...defaultProps} />);

        const switchEl = screen.getByTestId("mock-switch");
        fireEvent.click(switchEl); // restricted -> public

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith(true);
            expect(mockToast).not.toHaveBeenCalled();
        });
    });

    it("reverts switch state on API failure", async () => {
        // Setup mutation to fail
        (useMutation as any).mockImplementation((options: any) => ({
            mutate: (data: any) => {
                mockMutate(data);
                // Simulate async error
                setTimeout(() => {
                    if (options.onError) options.onError(new Error("API Failed"));
                }, 0);
            },
            isPending: false,
        }));

        render(<ShareDialog {...defaultProps} />);

        const switchEl = screen.getByTestId("mock-switch");

        // Initial state: false
        expect(switchEl).toHaveAttribute("aria-checked", "false");

        // Click to toggle (Optimistic update sets to true)
        fireEvent.click(switchEl);

        // Expect error toast
        await waitFor(() => {
            expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
                description: en.share.updateError
            }));
        });

        // Should be false again
        await waitFor(() => {
            expect(switchEl).toHaveAttribute("aria-checked", "false");
        });
    });

    it("displays restricted link label, description, and enables 1-click sharing with button", async () => {
        (useQuery as any).mockReturnValue({
            data: 'restricted',
            isLoading: false
        });

        render(<ShareDialog {...defaultProps} />);

        expect(screen.getByText(en.share.restrictedLink)).toBeInTheDocument();
        expect(screen.getByText(en.share.restrictedNote)).toBeInTheDocument();

        const enableBtn = screen.getByTestId("button-enable-public-sharing");
        expect(enableBtn).toBeInTheDocument();
        expect(enableBtn).toHaveTextContent(en.share.enablePublicAction);

        fireEvent.click(enableBtn);

        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith(true);
        });
    });

    it("displays public link label and note when group is public", () => {
        (useQuery as any).mockReturnValue({
            data: 'public',
            isLoading: false
        });

        render(<ShareDialog {...defaultProps} />);

        expect(screen.getByText(en.share.publicLink)).toBeInTheDocument();
        expect(screen.getByText(en.share.publicNote)).toBeInTheDocument();
        expect(screen.queryByTestId("button-enable-public-sharing")).not.toBeInTheDocument();
    });

    it("renders collaborators with avatars, names, roles, and managed accounts", () => {
        const mockParticipants = {
            accessMode: "restricted",
            collaborators: [
                { id: "perm-1", email: "alice@example.com", displayName: "Alice Owner", role: "owner" },
                { id: "perm-2", email: "charlie@example.com", displayName: "Charlie Member", role: "editor" }
            ],
            accounts: [
                {
                    member: { userId: "user-1", email: "alice@example.com", name: "Alice", role: "owner", joinedAt: new Date() },
                    kind: "personal",
                    managers: [{ id: "perm-1", email: "alice@example.com", displayName: "Alice Owner", role: "owner" }]
                },
                {
                    member: { userId: "user-shared", email: "", name: "Garcia Family", role: "member", joinedAt: new Date() },
                    kind: "shared",
                    managers: [{ id: "perm-2", email: "charlie@example.com", displayName: "Charlie Member", role: "editor" }]
                }
            ],
            unassignedCollaborators: []
        };

        (useQuery as any).mockImplementation(({ queryKey }: any) => {
            if (queryKey[0] === "group-participants") {
                return { data: mockParticipants, isLoading: false };
            }
            return { data: "restricted", isLoading: false };
        });

        render(<ShareDialog {...defaultProps} />);

        expect(screen.getByText("Alice Owner")).toBeInTheDocument();
        expect(screen.getByText("alice@example.com")).toBeInTheDocument();
        expect(screen.getByText("Charlie Member")).toBeInTheDocument();
        expect(screen.getByText("charlie@example.com")).toBeInTheDocument();
        expect(screen.getByText(/Managing: Garcia Family/i)).toBeInTheDocument();
        expect(screen.getByTestId("button-revoke-charlie@example.com")).toBeInTheDocument();
    });

    it("prompts confirmation and calls removeGroupCollaborator when owner revokes access", async () => {
        const mockParticipants = {
            accessMode: "restricted",
            collaborators: [
                { id: "perm-1", email: "alice@example.com", displayName: "Alice Owner", role: "owner" },
                { id: "perm-2", email: "charlie@example.com", displayName: "Charlie Member", role: "editor" }
            ],
            accounts: [],
            unassignedCollaborators: []
        };

        (useQuery as any).mockImplementation(({ queryKey }: any) => {
            if (queryKey[0] === "group-participants") {
                return { data: mockParticipants, isLoading: false };
            }
            return { data: "restricted", isLoading: false };
        });

        const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

        render(<ShareDialog {...defaultProps} />);

        const revokeBtn = screen.getByTestId("button-revoke-charlie@example.com");
        fireEvent.click(revokeBtn);

        expect(confirmSpy).toHaveBeenCalled();
        expect(mockMutate).toHaveBeenCalledWith(mockParticipants.collaborators[1]);
        confirmSpy.mockRestore();
    });
});
