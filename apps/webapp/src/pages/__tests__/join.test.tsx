import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import JoinPage from "../join";
import { useAuth } from "@/context/auth-provider";
import { useAppContext } from "@/context/app-context";
import { useMutation } from "@tanstack/react-query";
import en from "@/locales/en/translation.json";

// Hoist mocks
const { mockNavigate } = vi.hoisted(() => ({
    mockNavigate: vi.fn(),
}));

// Mock hooks
vi.mock("@/context/auth-provider", () => ({
    useAuth: vi.fn(),
}));

vi.mock("@/context/app-context", () => ({
    useAppContext: vi.fn(),
}));

const mockMutate = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@tanstack/react-query")>();
    return {
        ...actual,
        useMutation: vi.fn(() => ({
            mutate: mockMutate,
            isPending: false,
            isSuccess: false,
            isError: false,
            error: null
        })),
        useQueryClient: vi.fn(() => ({
            invalidateQueries: vi.fn(),
            setQueryData: vi.fn(),
        })),
    };
});

// Mock router
vi.mock("react-router-dom", async () => {
    const actual = await vi.importActual("react-router-dom");
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

// Mock Picker
const mockOpenPicker = vi.fn();
vi.mock("@/hooks/use-google-picker", () => ({
    useGooglePicker: ({ onPick }: any) => {
        return { openPicker: () => mockOpenPicker(onPick), isLoaded: true, error: null };
    }
}));

const mockValidateQuozenSpreadsheet = vi.fn();
vi.mock("@/lib/storage", () => ({
    quozen: {
        groups: {
            validateQuozenSpreadsheet: (...args: any[]) => mockValidateQuozenSpreadsheet(...args),
            joinGroup: vi.fn(),
            importGroup: vi.fn(),
        }
    }
}));

describe("JoinPage", () => {
    const mockSetActiveGroup = vi.fn();
    const mockUser = { id: "u1", email: "test@example.com" };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        (useAppContext as any).mockReturnValue({ setActiveGroupId: mockSetActiveGroup });

        (useMutation as any).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
            isSuccess: false,
            isError: false
        });
        mockOpenPicker.mockImplementation((cb) => cb({ id: "123" })); // Default success
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows welcome screen and calls join API on click", async () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: true, user: mockUser, isLoading: false });

        render(
            <MemoryRouter initialEntries={["/join/123?name=TestGroup&inviter=Alice"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Verify Welcome Screen
        expect(screen.getByText(en.join.welcomeTitle)).toBeInTheDocument();
        expect(screen.getByText(/Alice.*TestGroup/)).toBeInTheDocument();

        // Click Join
        fireEvent.click(screen.getByText(en.join.joinButton));

        await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    });

    it("handles Access Denied error and shows recovery UI", async () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: true, user: mockUser, isLoading: false });

        // Simulate Access Denied error in mutation
        (useMutation as any).mockImplementation((options: any) => ({
            mutate: () => {
                const error = new Error("403 Forbidden");
                if (options.onError) options.onError(error);
            },
            isPending: false,
            isSuccess: false,
            isError: true,
            error: new Error("403 Forbidden")
        }));

        render(
            <MemoryRouter initialEntries={["/join/123"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Click Join to trigger mutation
        fireEvent.click(screen.getByText(en.join.joinButton));

        await waitFor(() => {
            expect(screen.getByText(en.join.accessRequired)).toBeInTheDocument();
        });
    });

    it("handles Stuck state (Already Member) by treating it as success and redirecting", async () => {
        vi.useFakeTimers();

        (useAuth as any).mockReturnValue({ isAuthenticated: true, user: mockUser, isLoading: false });

        // Setup mock: isSuccess MUST be false initially so useEffect calls mutate
        (useMutation as any).mockImplementation((options: any) => ({
            mutate: () => {
                // Call success immediately
                if (options.onSuccess) options.onSuccess({ id: "123", name: "Existing Group" });
            },
            isPending: false,
            isSuccess: false, // Important: must be false to trigger the effect
            data: null
        }));

        render(
            <MemoryRouter initialEntries={["/join/123"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Advance timers to trigger the setTimeout in onSuccess
        await act(async () => {
            // Trigger Join manually first
            fireEvent.click(screen.getByText(en.join.joinButton));

            vi.advanceTimersByTime(1500);
        });

        expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });

    it("shows Step 1/Step 2 flow on 404/Access Denied", async () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: true, user: mockUser, isLoading: false });

        // 1. Initial Failure (404)
        (useMutation as any).mockImplementation((options: any) => ({
            mutate: () => {
                const error = new Error("404 File not found"); // Google API 404 message style
                if (options.onError) options.onError(error);
            },
            isPending: false,
            isSuccess: false,
            isError: true,
            error: new Error("File not found")
        }));

        render(
            <MemoryRouter initialEntries={["/join/123"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Trigger Join
        fireEvent.click(screen.getByText(en.join.joinButton));

        // 2. Verify Manual Pick UI appears
        await waitFor(async () => {
            // 3. Verify it is a link with correct href
            const link = screen.getByRole("link", { name: en.join.openButton });
            expect(link).toHaveAttribute("href", "https://docs.google.com/spreadsheets/d/123");

            // 4. Verify Step 2 is disabled initially
            const step2Btn = screen.getByText(en.join.selectButton).closest('button');
            expect(step2Btn).toBeDisabled();

            // 5. Click Step 1, then Step 2 should enable
            fireEvent.click(link);
            expect(step2Btn).not.toBeDisabled();

            // 6. Click Step 2
            fireEvent.click(step2Btn!); // Use non-null assertion as we verified presence
            expect(mockOpenPicker).toHaveBeenCalled();
        });
    });

    it("allows selecting an existing account when 'Use an existing account in this group' is clicked without premature submit", async () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: true, user: mockUser, isLoading: false, login: vi.fn(), logout: vi.fn() });
        mockValidateQuozenSpreadsheet.mockResolvedValue({
            valid: true,
            members: [
                { userId: "acc-shared", name: "Garcia Family", email: "alice@example.com", role: "owner", joinedAt: new Date() },
                { userId: "acc-2", name: "Charlie", email: "charlie@example.com", role: "member", joinedAt: new Date() }
            ]
        });

        render(
            <MemoryRouter initialEntries={["/join/123?name=TestGroup&inviter=Alice"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        const useExistingBtn = screen.getByTestId("button-use-existing-account");
        fireEvent.click(useExistingBtn);

        await waitFor(() => {
            expect(mockValidateQuozenSpreadsheet).toHaveBeenCalledWith("123");
            expect(screen.getByTestId("join-existing-account-acc-shared")).toBeInTheDocument();
        });

        // 1. Selecting an account does NOT trigger joinMutation immediately
        fireEvent.click(screen.getByTestId("join-existing-account-acc-shared"));
        expect(mockMutate).not.toHaveBeenCalled();

        // 2. Primary button updates label to reflect the selected account
        const joinBtn = screen.getByTestId("button-join-group");
        expect(joinBtn).toHaveTextContent("Join as Garcia Family");

        // 3. Clicking the primary button triggers the mutation with the accountId
        fireEvent.click(joinBtn);
        await waitFor(() => {
            expect(mockMutate).toHaveBeenCalledWith({
                accountId: "acc-shared"
            });
        });
    });

    it("renders dedicated Google Sign-in card when unauthenticated and triggers login", async () => {
        const mockLogin = vi.fn();
        (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null, isLoading: false, login: mockLogin, logout: vi.fn() });

        render(
            <MemoryRouter initialEntries={["/join/123?name=TestGroup&inviter=Alice"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Verify Sign-in card is displayed
        expect(screen.getByText(en.join.signInTitle)).toBeInTheDocument();
        expect(screen.getByTestId("button-join-signin")).toBeInTheDocument();

        // Clicking Sign-in calls login()
        fireEvent.click(screen.getByTestId("button-join-signin"));
        expect(mockLogin).toHaveBeenCalledTimes(1);
    });

    it("handles 401 Session expired error gracefully by showing the re-login flow", async () => {
        const mockLogout = vi.fn();
        const mockLogin = vi.fn();
        let isAuth = true;

        (useAuth as any).mockImplementation(() => ({
            isAuthenticated: isAuth,
            user: mockUser,
            isLoading: false,
            login: mockLogin,
            logout: () => {
                isAuth = false;
                mockLogout();
            }
        }));

        (useMutation as any).mockImplementation((options: any) => ({
            mutate: () => {
                const error = new Error("Session expired (401). Please reload to sign in again.");
                if (options.onError) options.onError(error);
            },
            isPending: false,
            isSuccess: false,
            isError: true,
            error: new Error("Session expired (401)")
        }));

        const { rerender } = render(
            <MemoryRouter initialEntries={["/join/123?name=TestGroup&inviter=Alice"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        // Click Join Group to trigger 401
        fireEvent.click(screen.getByTestId("button-join-group"));

        expect(mockLogout).toHaveBeenCalled();

        // Re-render to reflect unauthenticated / expired state
        rerender(
            <MemoryRouter initialEntries={["/join/123?name=TestGroup&inviter=Alice"]}>
                <Routes>
                    <Route path="/join/:id" element={<JoinPage />} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText(en.join.sessionExpiredTitle)).toBeInTheDocument();
        expect(screen.getByTestId("button-join-signin")).toBeInTheDocument();
    });
});


