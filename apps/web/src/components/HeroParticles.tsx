import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useTheme } from "../theme";

type VantaEffect = { destroy: () => void };

type VantaDots = (options: Record<string, unknown>) => VantaEffect;

export function HeroParticles() {
  const elRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    window.THREE = THREE;

    let cancelled = false;
    const effect: { current?: VantaEffect } = {};

    void import("vanta/dist/vanta.dots.min").then((mod) => {
      if (cancelled || !elRef.current) return;
      const DOTS = ((mod as { default?: VantaDots }).default ??
        window.VANTA?.DOTS) as VantaDots | undefined;
      if (!DOTS) return;
      effect.current = DOTS({
        el: elRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: true,
        minHeight: 200.0,
        minWidth: 200.0,
        scale: 1.0,
        scaleMobile: 1.0,
        color: theme === "dark" ? 0x4a8f71 : 0x8585be,
        color2: theme === "dark" ? 0x76577a : 0x9e6e9e,
        backgroundColor: theme === "dark" ? 0x0b100d : 0xffffff,
        size: 3.6,
        spacing: 100.0,
        showLines: false,
      });
    });

    return () => {
      cancelled = true;
      effect.current?.destroy();
    };
  }, [theme]);

  return (
    <div
      ref={elRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-hidden [&_canvas]:pointer-events-none"
      aria-hidden="true"
    />
  );
}
