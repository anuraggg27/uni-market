import type { CSSProperties } from "react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { useTheme } from "../../theme";

const toastStyles = {
  "--normal-bg": "var(--color-surface)",
  "--normal-text": "var(--color-ink)",
  "--normal-border": "var(--color-line)",
} as CSSProperties;

export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();

  return (
    <SonnerToaster
      closeButton
      mobileOffset={{
        top: "calc(env(safe-area-inset-top) + 4.75rem)",
        left: "1rem",
        right: "1rem",
      }}
      offset={{ top: "5rem", right: "1.5rem" }}
      position="top-right"
      theme={theme}
      toastOptions={{ duration: 3_500 }}
      style={toastStyles}
      {...props}
    />
  );
}
