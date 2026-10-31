import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "../theme-context";
import { useSettings } from "@/hooks/use-settings";

vi.mock("@/hooks/use-settings", () => ({
  useSettings: vi.fn(),
}));

// Test consumer component
function TestConsumer() {
  const { theme, resolvedTheme, systemTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <span data-testid="system-theme">{systemTheme}</span>
      <button onClick={() => setTheme("light")} data-testid="btn-light">Set Light</button>
      <button onClick={() => setTheme("dark")} data-testid="btn-dark">Set Dark</button>
      <button onClick={() => setTheme("system")} data-testid="btn-system">Set System</button>
    </div>
  );
}

describe("ThemeContext & ThemeProvider", () => {
  let mediaQueryListeners: ((e: any) => void)[] = [];
  let isDarkMode = false;
  let mockUpdateSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mediaQueryListeners = [];
    isDarkMode = false;
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    mockUpdateSettings = vi.fn();

    (useSettings as any).mockReturnValue({
      settings: {
        preferences: {
          defaultCurrency: "USD",
        },
      },
      updateSettings: mockUpdateSettings,
    });

    // Mock matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      return {
        matches: query === "(prefers-color-scheme: dark)" ? isDarkMode : false,
        media: query,
        onchange: null,
        addListener: vi.fn((listener) => mediaQueryListeners.push(listener)),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event, listener) => {
          if (event === "change") mediaQueryListeners.push(listener);
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    });

    // Ensure meta tags exist
    let colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (!colorSchemeMeta) {
      colorSchemeMeta = document.createElement("meta");
      colorSchemeMeta.setAttribute("name", "color-scheme");
      document.head.appendChild(colorSchemeMeta);
    }
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeColorMeta) {
      themeColorMeta = document.createElement("meta");
      themeColorMeta.setAttribute("name", "theme-color");
      document.head.appendChild(themeColorMeta);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to 'system' theme", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme").textContent).toBe("system");
  });

  it("resolves to light when OS is light in system mode", () => {
    isDarkMode = false;

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves to dark when OS is dark in system mode", () => {
    isDarkMode = true;

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies dark mode when user selects dark", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByTestId("btn-dark"));

    expect(screen.getByTestId("current-theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("quozen_theme_preference")).toBe("dark");
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          theme: "dark",
        }),
      })
    );
  });

  it("applies light mode when user selects light even if OS is dark", async () => {
    isDarkMode = true;
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByTestId("btn-light"));

    expect(screen.getByTestId("current-theme").textContent).toBe("light");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("quozen_theme_preference")).toBe("light");
    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        preferences: expect.objectContaining({
          theme: "light",
        }),
      })
    );
  });

  it("dynamically reacts to OS theme changes when in system mode", () => {
    isDarkMode = false;

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("resolved-theme").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Simulate OS switching to dark mode
    act(() => {
      isDarkMode = true;
      for (const listener of mediaQueryListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("loads theme from settings when available (persisted across devices)", () => {
    (useSettings as any).mockReturnValue({
      settings: {
        preferences: {
          defaultCurrency: "EUR",
          theme: "dark",
        },
      },
      updateSettings: mockUpdateSettings,
    });

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved-theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("updates meta color-scheme and theme-color when theme changes", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await user.click(screen.getByTestId("btn-dark"));

    const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');

    expect(colorSchemeMeta?.getAttribute("content")).toBe("dark");
    expect(themeColorMeta?.getAttribute("content")).toBe("#020817");

    await user.click(screen.getByTestId("btn-light"));

    expect(colorSchemeMeta?.getAttribute("content")).toBe("light");
    expect(themeColorMeta?.getAttribute("content")).toBe("#0F766E");
  });
});
