import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import OnlineRequiredDialog from "../online-required-dialog";
import en from "@/locales/en/translation.json";

describe("OnlineRequiredDialog", () => {
  it("renders with custom message when provided", () => {
    const onOpenChange = vi.fn();
    render(
      <OnlineRequiredDialog
        isOpen={true}
        onOpenChange={onOpenChange}
        customMessage="Custom offline restriction message"
      />
    );

    expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
    expect(screen.getByText(en.offline.requiredTitle)).toBeInTheDocument();
    expect(screen.getByText("Custom offline restriction message")).toBeInTheDocument();

    const confirmBtn = screen.getByTestId("online-required-confirm");
    expect(confirmBtn).toHaveTextContent(en.offline.gotIt);
    fireEvent.click(confirmBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders with reason translation and interpolated params", () => {
    const onOpenChange = vi.fn();
    render(
      <OnlineRequiredDialog
        isOpen={true}
        onOpenChange={onOpenChange}
        reason="inviteEmail"
        reasonParams={{ email: "friend@example.com" }}
      />
    );

    expect(screen.getByTestId("online-required-dialog")).toBeInTheDocument();
    expect(screen.getByText(/friend@example\.com/)).toBeInTheDocument();
  });

  it("renders default unhydratedGroup message when no reason or customMessage is provided", () => {
    render(
      <OnlineRequiredDialog
        isOpen={true}
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.getByText(en.offline.reasons.unhydratedGroup)).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <OnlineRequiredDialog
        isOpen={false}
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.queryByTestId("online-required-dialog")).not.toBeInTheDocument();
  });
});
