import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? "theme-toggle-compact" : ""}`}
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={dark}
      title={label}
    >
      {compact ? (
        dark ? (
          <Sun aria-hidden="true" />
        ) : (
          <Moon aria-hidden="true" />
        )
      ) : (
        <>
          <Sun aria-hidden="true" />
          <span className="theme-toggle-thumb" aria-hidden="true" />
          <Moon aria-hidden="true" />
        </>
      )}
    </button>
  );
}
