// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useGroups } from "../use-groups";
import { vi, describe, it, expect } from "vitest";
import { useSettings } from "../use-settings";

vi.mock("../use-settings", () => ({
  useSettings: vi.fn(),
}));

describe("useGroups Hook", () => {
  it("maps cached groups and preserves the icon property", () => {
    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: {
        activeGroupId: "group-1",
        groupCache: [
          {
            id: "group-1",
            name: "Dining Out",
            role: "owner",
            icon: "preset:utensils",
            lastAccessed: "2026-03-01T00:00:00.000Z"
          },
          {
            id: "group-2",
            name: "Vacation",
            role: "member",
            icon: "preset:plane",
            lastAccessed: "2026-03-02T00:00:00.000Z"
          }
        ],
        archivedGroupCache: [
          {
            id: "group-3",
            name: "Old Project",
            role: "owner",
            icon: "preset:briefcase",
            isArchived: true,
            lastAccessed: "2026-02-01T00:00:00.000Z"
          }
        ]
      },
      isLoading: false,
      error: null
    });

    const { result } = renderHook(() => useGroups());

    expect(result.current.groups).toHaveLength(2);
    expect(result.current.groups[0].id).toBe("group-1");
    expect(result.current.groups[0].name).toBe("Dining Out");
    expect(result.current.groups[0].icon).toBe("preset:utensils");
    expect(result.current.groups[1].icon).toBe("preset:plane");

    expect(result.current.archivedGroups).toHaveLength(1);
    expect(result.current.archivedGroups[0].id).toBe("group-3");
    expect(result.current.archivedGroups[0].icon).toBe("preset:briefcase");
  });

  it("handles empty or missing icon gracefully", () => {
    (useSettings as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      settings: {
        activeGroupId: "group-1",
        groupCache: [
          {
            id: "group-1",
            name: "No Icon Group",
            role: "owner"
          }
        ],
        archivedGroupCache: []
      },
      isLoading: false,
      error: null
    });

    const { result } = renderHook(() => useGroups());
    expect(result.current.groups[0].icon).toBeUndefined();
  });
});
