import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GroupDialog from "../group-dialog";

vi.mock("@/hooks/use-auto-sync", () => ({
    useAutoSync: () => ({ setPaused: vi.fn() })
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => {
            const translations: Record<string, string> = {
                "groups.create": "Create Group",
                "groups.edit": "Edit Group",
                "groups.new": "Create a new expense group",
                "groups.update": "Update group settings",
                "groups.nameLabel": "Group Name",
                "groups.namePlaceholder": "e.g., Summer Trip 2026",
                "groups.membersLabel": "Members",
                "groups.iconLabel": "Group Icon & Banner",
                "groups.selectPreset": "Choose an icon or upload a photo",
                "groups.uploadPhoto": "Upload Photo",
                "groups.removeIcon": "Remove Icon",
                "common.cancel": "Cancel",
                "common.save": "Save Changes",
                "groups.createButton": "Create Group"
            };
            return translations[key] || key;
        }
    })
}));

describe("GroupDialog Component", () => {
    it("renders group name input, preset icons, and upload button in create mode", () => {
        render(
            <GroupDialog
                open={true}
                onOpenChange={vi.fn()}
                mode="create"
                isPending={false}
                onSubmit={vi.fn()}
            />
        );

        expect(screen.getByTestId("drawer-title-group")).toHaveTextContent("Create Group");
        expect(screen.getByLabelText(/Group Name/i)).toBeInTheDocument();
        expect(screen.getByText("Upload Photo")).toBeInTheDocument();
    });

    it("allows selecting a preset icon and submits it", async () => {
        const onSubmit = vi.fn();
        render(
            <GroupDialog
                open={true}
                onOpenChange={vi.fn()}
                mode="create"
                isPending={false}
                onSubmit={onSubmit}
            />
        );

        const nameInput = screen.getByLabelText(/Group Name/i);
        fireEvent.change(nameInput, { target: { value: "Trip to Paris" } });

        // Select the plane preset button
        const planePreset = screen.getByTestId("preset-icon-preset:plane");
        expect(planePreset).toBeInTheDocument();
        fireEvent.click(planePreset);

        // Submit form
        const submitBtn = screen.getByRole("button", { name: /Create Group/i });
        fireEvent.click(submitBtn);

        expect(onSubmit).toHaveBeenCalledWith({
            name: "Trip to Paris",
            members: [],
            icon: "preset:plane"
        });
    });

    it("pre-populates initialIcon in edit mode and allows clearing it", async () => {
        const onSubmit = vi.fn();
        render(
            <GroupDialog
                open={true}
                onOpenChange={vi.fn()}
                mode="edit"
                initialName="Ski Club"
                initialIcon="preset:plane"
                isPending={false}
                onSubmit={onSubmit}
            />
        );

        expect(screen.getByDisplayValue("Ski Club")).toBeInTheDocument();

        // Clear icon button
        const clearBtn = screen.getByTestId("button-clear-icon");
        expect(clearBtn).toBeInTheDocument();
        fireEvent.click(clearBtn);

        // Submit form
        const submitBtn = screen.getByTestId("button-submit-group");
        fireEvent.click(submitBtn);

        expect(onSubmit).toHaveBeenCalledWith({
            name: "Ski Club",
            members: [],
            icon: ""
        });
    });
});
