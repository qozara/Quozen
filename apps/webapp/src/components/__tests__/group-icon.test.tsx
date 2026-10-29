import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupIcon, GROUP_ICON_PRESETS, getGroupPresetBackground } from "../group-icon";

describe("GroupIcon Component", () => {
    it("renders fallback Users icon when no icon is provided", () => {
        const { container } = render(<GroupIcon name="Family" />);
        expect(container.querySelector("svg")).toBeInTheDocument();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("renders an img tag when a custom image data URL is provided", () => {
        const dataUrl = "data:image/webp;base64,mockWebpData";
        render(<GroupIcon icon={dataUrl} name="Trip 2026" />);
        const img = screen.getByRole("img", { name: "Trip 2026" });
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute("src", dataUrl);
    });

    it("renders preset icon when preset key is provided", () => {
        const { container } = render(<GroupIcon icon="preset:plane" name="Vacation" />);
        expect(container.querySelector("svg")).toBeInTheDocument();
        expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("provides list of curated presets", () => {
        expect(GROUP_ICON_PRESETS.length).toBeGreaterThanOrEqual(6);
        expect(GROUP_ICON_PRESETS.some(p => p.id === "preset:home")).toBe(true);
        expect(GROUP_ICON_PRESETS.some(p => p.id === "preset:plane")).toBe(true);
    });

    it("returns correct background gradient or image for blurred banner", () => {
        const presetBg = getGroupPresetBackground("preset:home");
        expect(presetBg).toContain("linear-gradient");

        const customBg = getGroupPresetBackground("data:image/webp;base64,abc");
        expect(customBg).toBe("url(data:image/webp;base64,abc)");

        const fallbackBg = getGroupPresetBackground(undefined);
        expect(fallbackBg).toBeNull();
    });
});
