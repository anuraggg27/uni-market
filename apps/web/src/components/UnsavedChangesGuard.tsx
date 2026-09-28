import { useCallback, useEffect, type RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";

export function UnsavedChangesGuard({ when, allowLeave }: { when: boolean; allowLeave: RefObject<boolean> }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    when && !allowLeave.current &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useBeforeUnload(useCallback((event) => {
    if (!when || allowLeave.current) return;
    event.preventDefault();
    event.returnValue = "";
  }, [allowLeave, when]));

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Leave this listing? Your unsaved changes and selected photos will be lost.")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  return null;
}
