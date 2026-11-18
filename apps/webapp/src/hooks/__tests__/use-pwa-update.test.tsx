import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import en from "@/locales/en/translation.json";
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
    unregister: ReturnType<typeof vi.fn>;
    waiting: Partial<ServiceWorker> | null;
    installing: Partial<ServiceWorker> | null;
    active: Partial<ServiceWorker> | null;
  };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSwOptions = null;
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "test-hash" }), { status: 200 })
    ) as unknown as typeof fetch;

    mockRegistration = {
      update: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(true),
      waiting: null,
      installing: null,
      active: { state: "activated" },
    };
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    await act(async () => {
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

  it("applyUpdate posts SKIP_WAITING to waiting worker and reloads the window", async () => {
    const postMessageMock = vi.fn();
    mockRegistration.waiting = {
      postMessage: postMessageMock,
    } as any;

    const originalLocation = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
      capturedSwOptions.onNeedRefresh?.();
    });

    // Click apply update button
    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-apply"));
    });

    // Should post SKIP_WAITING to waiting worker
    expect(postMessageMock).toHaveBeenCalledWith({ type: "SKIP_WAITING" });

    // Should trigger reload via controllerchange or fallback
    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalled();
    }, { timeout: 2000 });

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("handles installing worker already in installed state without hanging", async () => {
    mockRegistration.update = vi.fn().mockImplementation(async () => {
      mockRegistration.installing = {
        state: "installed",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;
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
      expect(screen.getByTestId("need-refresh")).toHaveTextContent("true");
      expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
    });
  });

  it("recovers from hanging reg.update() and version.json via timeout, resets isChecking, and shows error instead of Up to Date", async () => {
    vi.useFakeTimers();

    // Never resolves
    mockRegistration.update = vi.fn().mockImplementation(() => new Promise(() => {}));
    globalThis.fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-check"));
    });

    expect(screen.getByTestId("is-checking")).toHaveTextContent("true");

    // Advance time past network + SW timeouts
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: en.common.error,
        description: en.pwa.checkErrorDesc,
        variant: "destructive",
      })
    );
  });

  it("detects update via /version.json when iOS reg.update() hangs and applies self-healing recovery", async () => {
    vi.useFakeTimers();

    // Hang reg.update() indefinitely (iOS standalone Home Screen bug)
    mockRegistration.update = vi.fn().mockImplementation(() => new Promise(() => {}));
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "new-hash" }), { status: 200 })
    ) as unknown as typeof fetch;

    const originalServiceWorker = navigator.serviceWorker;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {},
        getRegistration: vi.fn().mockResolvedValue(mockRegistration),
        getRegistrations: vi.fn().mockResolvedValue([mockRegistration]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const deletedCaches: string[] = [];
    const originalCaches = window.caches;
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: {
        keys: vi.fn().mockResolvedValue(["workbox-precache-v2-quozen", "google-fonts-cache"]),
        delete: vi.fn(async (key: string) => {
          deletedCaches.push(key);
          return true;
        }),
      },
    });

    const originalLocation = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });

    localStorage.setItem("quozen_keep_test", "preserved");

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    act(() => {
      fireEvent.click(screen.getByTestId("btn-check"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByTestId("need-refresh")).toHaveTextContent("true");
    expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: en.pwa.updateAvailableTitle,
      })
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-apply"));
    });

    expect(mockRegistration.unregister).toHaveBeenCalledTimes(1);
    expect(deletedCaches).toEqual(["workbox-precache-v2-quozen"]);
    expect(deletedCaches).not.toContain("google-fonts-cache");
    expect(localStorage.getItem("quozen_keep_test")).toBe("preserved");
    expect(reloadMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
    Object.defineProperty(window, "caches", { configurable: true, value: originalCaches });
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("shows explicit error toast and never Up to Date when /version.json returns HTTP 500", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Internal Server Error", { status: 500 })
    ) as unknown as typeof fetch;

    render(
      <PwaUpdateProvider>
        <TestConsumer />
      </PwaUpdateProvider>
    );

    act(() => {
      capturedSwOptions.onRegisteredSW?.("/sw.js", mockRegistration);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("btn-check"));
    });

    expect(screen.getByTestId("need-refresh")).toHaveTextContent("false");
    expect(screen.getByTestId("is-checking")).toHaveTextContent("false");
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: en.common.error,
        description: en.pwa.checkErrorDesc,
        variant: "destructive",
      })
    );
  });
});
