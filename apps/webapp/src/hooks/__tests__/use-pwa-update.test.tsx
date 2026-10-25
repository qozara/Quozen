import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PwaUpdateProvider, usePwaUpdate } from "../use-pwa-update";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
  toast: (...args: any[]) => mockToast(...args),
}));

const mockUpdateServiceWorker = vi.fn().mockResolvedValue(undefined);
let capturedSwOptions: any = null;

vi.mock("virtual:pwa-register", () => ({
  registerSW: vi.fn((options: any) => {
    capturedSwOptions = options;
    return mockUpdateServiceWorker;
  }),
}));

function TestConsumer() {
  const { needRefresh, isChecking, checkForUpdates, applyUpdate } = usePwaUpdate();
  return (
    <div>
      <span data-testid="need-refresh">{String(needRefresh)}</span>
      <span data-testid="is-checking">{String(isChecking)}</span>
      <button data-testid="btn-check" onClick={() => void checkForUpdates()}>
        Check
      </button>
      <button data-testid="btn-apply" onClick={() => void applyUpdate()}>
        Apply
      </button>
    </div>
  );
}

describe("usePwaUpdate & PwaUpdateProvider", () => {
  let mockRegistration: {
    update: ReturnType<typeof vi.fn>;
    waiting: Partial<ServiceWorker> | null;
    installing: Partial<ServiceWorker> | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSwOptions = null;
    mockRegistration = {
      update: vi.fn().mockResolvedValue(undefined),
      waiting: null,
      installing: null,
    };
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast notification prompt with reload action when a new version is detected", async () => {
    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    expect(capturedSwOptions).toBeTruthy();
    expect(screen.getByTestId("need-refresh")).toHaveTextContent("false");

    act(() => {
      capturedSwOptions.onNeedRefresh?.();
    });

    expect(screen.getByTestId("need-refresh")).toHaveTextContent("true");
    expect(mockToast).toHaveBeenCalledTimes(1);
    const toastCall = mockToast.mock.calls[0][0];
    expect(toastCall.title).toBeTruthy();
    expect(toastCall.action).toBeTruthy();

    // Render the toast action button and click it to verify it applies the update
    const { getByTestId } = render(<>{toastCall.action}</>);
    fireEvent.click(getByTestId("button-pwa-reload"));
    expect(mockUpdateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("checks for updates on visibilitychange when app resumes from background with cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    // Initial registration checks or records baseline
    mockRegistration.update.mockClear();

    // Simulate resume within cooldown (< 15 mins) -> should not spam update()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mockRegistration.update).not.toHaveBeenCalled();

    // Advance past 15-minute cooldown and resume app
    vi.advanceTimersByTime(16 * 60 * 1000);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mockRegistration.update).toHaveBeenCalledTimes(1);
  });

  it("manual checkForUpdates calls registration.update() and notifies when already up to date", async () => {
    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    fireEvent.click(screen.getByTestId("btn-check"));

    await waitFor(() => {
      expect(mockRegistration.update).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("test-hash"),
        })
      );
    });
  });

  it("manual checkForUpdates triggers update prompt if a waiting worker is found", async () => {
    mockRegistration.update = vi.fn().mockImplementation(async () => {
      mockRegistration.waiting = { state: "installed" };
    });

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    fireEvent.click(screen.getByTestId("btn-check"));

    await waitFor(() => {
      expect(mockRegistration.update).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("need-refresh")).toHaveTextContent("true");
    });
  });
});
