import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export function RouteScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, { left: number; top: number }>());

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const scrollPositions = positions.current;
    const locationKey = location.key;
    const savedPosition = scrollPositions.get(locationKey);
    let restorationFrame: number | undefined;

    if (navigationType === "POP" && savedPosition) {
      restorationFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ ...savedPosition, behavior: "auto" });
      });
    } else if (navigationType !== "POP" && location.hash) {
      const target = document.getElementById(
        decodeURIComponent(location.hash.slice(1)),
      );
      if (target) {
        target.scrollIntoView();
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    } else if (navigationType !== "POP") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }

    return () => {
      if (restorationFrame !== undefined) {
        window.cancelAnimationFrame(restorationFrame);
      }
      scrollPositions.set(locationKey, {
        left: window.scrollX,
        top: window.scrollY,
      });
    };
  }, [location.hash, location.key, navigationType]);

  return null;
}
