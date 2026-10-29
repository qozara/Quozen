import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SyncTrigger } from "../sync/SyncTrigger";
import { useAutoSync } from "@/hooks/use-auto-sync";
import { useAppContext } from "@/context/app-context";
import "@/lib/i18n";

vi.mock("@/hooks/use-auto-sync", () => ({
  useAutoSync: vi.fn(),
}));

vi.mock("@/context/app-context", () => ({
  useAppContext: vi.fn(),
}));

describe("SyncTrigger & SyncInspectorPopover", () => {
  const triggerSyncMock = vi.fn().mockResolvedValue(undefined);
  const reconnectProviderMock = vi.fn().mockResolvedValue(undefined);
  const setSchemaErrorStatusMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAppContext as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      activeGroupId: "group-1",
      setSchemaErrorStatus: setSchemaErrorStatusMock,
    });
  });

  it("renders synced state and opens diagnostic popover with Force Sync button", () => {
    (useAutoSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isEnabled: true,
      isPaused: false,
      isOnline: true,
      lastSyncTime: new Date(),
      syncStatus: "idle",
      uxSyncState: "synced",
      setPaused: vi.fn(),
      triggerSync: triggerSyncMock,
      reconnectProvider: reconnectProviderMock,
    });

    render(
      <MemoryRouter>
        <SyncTrigger />
      </MemoryRouter>
    );

    const triggerBtn = screen.getByTestId("button-sync-status-trigger");
    expect(triggerBtn).toBeInTheDocument();

    // Open popover
    fireEvent.click(triggerBtn);

    const popover = screen.getByTestId("sync-inspector-popover");
    expect(popover).toBeInTheDocument();
    expect(popover.className).toContain("bg-popover");
    expect(popover.className).not.toContain("bg-popover/95");
    const forceSyncBtn = screen.getByTestId("button-force-sync");
    expect(forceSyncBtn).not.toBeDisabled();

    fireEvent.click(forceSyncBtn);
    expect(triggerSyncMock).toHaveBeenCalledTimes(1);
  });

  it("renders offline state and disables Force Sync button when offline", () => {
    (useAutoSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isEnabled: true,
      isPaused: false,
      isOnline: false,
      lastSyncTime: null,
      syncStatus: "idle",
      uxSyncState: "offline",
      setPaused: vi.fn(),
      triggerSync: triggerSyncMock,
      reconnectProvider: reconnectProviderMock,
    });

    render(
      <MemoryRouter>
        <SyncTrigger />
      </MemoryRouter>
    );

    const triggerBtn = screen.getByTestId("button-sync-status-trigger");
    fireEvent.click(triggerBtn);

    expect(screen.getByTestId("sync-inspector-popover")).toBeInTheDocument();
    const forceSyncBtn = screen.getByTestId("button-force-sync");
    expect(forceSyncBtn).toBeDisabled();
  });

  it("renders warning state and triggers reconnectProvider when auth_failed", () => {
    (useAutoSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isEnabled: true,
      isPaused: false,
      isOnline: true,
      lastSyncTime: null,
      syncStatus: "auth_failed",
      uxSyncState: "warning",
      setPaused: vi.fn(),
      triggerSync: triggerSyncMock,
      reconnectProvider: reconnectProviderMock,
    });

    render(
      <MemoryRouter>
        <SyncTrigger />
      </MemoryRouter>
    );

    const triggerBtn = screen.getByTestId("button-sync-status-trigger");
    fireEvent.click(triggerBtn);

    const reconnectBtn = screen.getByTestId("button-sync-reconnect");
    expect(reconnectBtn).toBeInTheDocument();

    fireEvent.click(reconnectBtn);
    expect(reconnectProviderMock).toHaveBeenCalledTimes(1);
  });
});
