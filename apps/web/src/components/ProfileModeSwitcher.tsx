import { Store, UserRound } from "lucide-react";
import { Link } from "react-router-dom";

type ProfileMode = "user" | "seller";

export function ProfileModeSwitcher({
  activeMode,
  sellerId,
}: {
  activeMode: ProfileMode;
  sellerId: string;
}) {
  return (
    <div className="profile-mode-switcher">
      <span className="profile-mode-label">Profile mode</span>
      <nav className="profile-mode-control" aria-label="Profile mode">
        <Link
          to="/profile"
          className={activeMode === "user" ? "is-active" : undefined}
          aria-current={activeMode === "user" ? "page" : undefined}
        >
          <UserRound aria-hidden="true" />
          <span>User profile</span>
        </Link>
        <Link
          to={`/seller/${sellerId}`}
          className={activeMode === "seller" ? "is-active" : undefined}
          aria-current={activeMode === "seller" ? "page" : undefined}
        >
          <Store aria-hidden="true" />
          <span>Seller profile</span>
        </Link>
      </nav>
    </div>
  );
}
