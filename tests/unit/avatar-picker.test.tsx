// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarPicker } from "../../apps/web/src/components/AvatarPicker";
import { UserAvatar } from "../../apps/web/src/components/UserAvatar";

describe("illustrated avatar components", () => {
  afterEach(() => cleanup());

  it("exposes the selected avatar and supports keyboard-accessible buttons", () => {
    const onChange = vi.fn();
    render(<AvatarPicker value="avatar-01" onChange={onChange} />);

    expect(screen.getAllByRole("radio")).toHaveLength(24);
    expect(screen.queryByText("Avatar 01")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Select Avatar 01 avatar" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Select Avatar 20 avatar" }));
    expect(onChange).toHaveBeenCalledWith("avatar-20");
  });

  it("shows achievement avatars while locked, explains taps, and enables only earned rewards", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AvatarPicker value="avatar-01" onChange={onChange} />,
    );
    const lockedListingAvatar = screen.getByRole("radio", {
      name: "First listing reward 1 avatar, locked",
    });
    expect(lockedListingAvatar).toHaveAttribute("aria-disabled", "true");
    expect(lockedListingAvatar).toHaveAttribute("data-locked", "true");
    expect(screen.getAllByText("Create your first listing to unlock")).toHaveLength(2);

    fireEvent.click(lockedListingAvatar);
    expect(onChange).not.toHaveBeenCalled();
    expect(lockedListingAvatar).toHaveAttribute("data-requirement-open", "true");

    rerender(
      <AvatarPicker
        value="avatar-01"
        onChange={onChange}
        unlockedAchievements={["FIRST_LISTING"]}
      />,
    );
    const unlockedListingAvatar = screen.getByRole("radio", {
      name: "Select First listing reward 1 avatar",
    });
    expect(unlockedListingAvatar).not.toHaveAttribute("aria-disabled");
    fireEvent.click(unlockedListingAvatar);
    expect(onChange).toHaveBeenCalledWith("unlock_listing_female");
    expect(screen.getByRole("radio", { name: "First purchase reward 1 avatar, locked" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("resolves a configured avatar and falls back for users without one", () => {
    const { rerender } = render(
      <UserAvatar avatarId="avatar-03" displayName="Asha Student" />,
    );
    expect(screen.getByRole("img", { name: "Asha Student's avatar" }))
      .toHaveAttribute("data-avatar-id", "avatar-03");

    const LegacyUserAvatar = UserAvatar as React.ComponentType<
      React.ComponentProps<typeof UserAvatar> & { avatarUrl: string }
    >;
    rerender(
      <LegacyUserAvatar
        avatarId={null}
        avatarUrl="https://lh3.googleusercontent.com/private-photo"
        displayName="New Student"
      />,
    );
    const fallbackAvatar = screen.getByRole("img", {
      name: "New Student's avatar",
    });
    expect(fallbackAvatar).toHaveAttribute("data-avatar-id", "avatar-01");
    expect(fallbackAvatar.querySelector("img")).toHaveAttribute(
      "src",
      "/avatars/avatar-01.webp",
    );
  });
});
