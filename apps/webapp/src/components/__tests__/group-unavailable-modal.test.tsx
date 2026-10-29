import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GroupUnavailableModal from "../group-unavailable-modal";
import { AppContext } from "@/context/app-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import en from "@/locales/en/translation.json";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate
}));

describe("GroupUnavailableModal", () => {
  let queryClient: QueryClient;
  const mockSetActiveGroupId = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    mockNavigate.mockClear();
    mockSetActiveGroupId.mockClear();
  });

  const renderModal = (activeGroupId = "group-1") => {
    return render(
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider
          value={{
            activeGroupId,
            setActiveGroupId: mockSetActiveGroupId,
            currentUserId: "u1",
            isAddExpenseOpen: false,
            setIsAddExpenseOpen: vi.fn(),
            expenseDraft: null,
            setExpenseDraft: vi.fn(),
            expenseDraftMeta: null,
            openExpenseWithDraft: vi.fn(),
            settlementDraftState: { isOpen: false },
            setSettlementDraftState: vi.fn(),
            openSettlementWithDraft: vi.fn(),
            schemaErrorStatus: null,
            setSchemaErrorStatus: vi.fn()
          }}
        >
          <GroupUnavailableModal />
        </AppContext.Provider>
      </QueryClientProvider>
    );
  };

  it("does not render when no event has been dispatched", () => {
    renderModal();
    expect(screen.queryByTestId("group-unavailable-modal")).not.toBeInTheDocument();
  });

  it("opens dialog on group-file-unavailable event and shows group title and description", () => {
    renderModal("group-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("group-file-unavailable", {
          detail: {
            groupId: "group-1",
            groupName: "Trip to Rome",
            reason: "deleted",
            fallbackGroupId: "group-2",
            hasRemainingGroups: true
          }
        })
      );
    });

    expect(screen.getByTestId("group-unavailable-modal")).toBeInTheDocument();
    expect(screen.getByTestId("group-unavailable-title")).toHaveTextContent(en.groups.fileUnavailableTitle);
    expect(screen.getByTestId("group-unavailable-description")).toHaveTextContent("Trip to Rome");
  });

  it("switches to fallback group when confirmed if active group was deleted", () => {
    renderModal("group-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("group-file-unavailable", {
          detail: {
            groupId: "group-1",
            groupName: "Trip to Rome",
            reason: "deleted",
            fallbackGroupId: "group-2",
            hasRemainingGroups: true
          }
        })
      );
    });

    const confirmBtn = screen.getByTestId("group-unavailable-confirm");
    fireEvent.click(confirmBtn);

    expect(mockSetActiveGroupId).toHaveBeenCalledWith("group-2");
    expect(mockNavigate).not.toHaveBeenCalledWith("/groups");
  });

  it("navigates to /groups when confirmed if no remaining groups exist", () => {
    renderModal("group-1");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("group-file-unavailable", {
          detail: {
            groupId: "group-1",
            groupName: "Last Group",
            reason: "trashed",
            fallbackGroupId: null,
            hasRemainingGroups: false
          }
        })
      );
    });

    const confirmBtn = screen.getByTestId("group-unavailable-confirm");
    fireEvent.click(confirmBtn);

    expect(mockSetActiveGroupId).toHaveBeenCalledWith("");
    expect(mockNavigate).toHaveBeenCalledWith("/groups");
  });
});
