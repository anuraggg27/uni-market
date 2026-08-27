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

    expect(screen.getAllByRole("radio")).toHaveLength(20);
    expect(screen.queryByText("Avatar 01")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Select Avatar 01 avatar" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Select Avatar 20 avatar" }));
    expect(onChange).toHaveBeenCalledWith("avatar-20");
  });

  it("resolves a configured avatar and falls back for users without one", () => {
    const { rerender } = render(
      <UserAvatar avatarId="avatar-03" displayName="Asha Student" />,
    );
    expect(screen.getByRole("img", { name: "Asha Student's avatar" }))
      .toHaveAttribute("data-avatar-id", "avatar-03");

    rerender(<UserAvatar avatarId={null} avatarUrl={null} displayName="New Student" />);
    expect(screen.getByRole("img", { name: "New Student's avatar" }))
      .toHaveAttribute("data-avatar-id", "fallback");
  });
});
