import { addEventListener, definePlugin, removeEventListener, toaster } from "@decky/api";
import type { ReactElement } from "react";
import { setCurrentGame } from "./backend";
import { trackGame } from "./game";
import { BasicPanel } from "./panel/BasicPanel";
import { ErrorBoundary } from "./panel/ErrorBoundary";
import { forgetPanelState } from "./panel/hooks";
import { Title } from "./panel/Title";

function Icon(): ReactElement {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

export default definePlugin(() => {
  // Registered at load, not in the panel, so a game change reaches the backend with the menu closed.
  const stopTracking = trackGame(setCurrentGame);
  const onRestart = addEventListener("daemon_restarted", () => {
    toaster.toast({ title: "Trackpad daemon restarted", body: "Your settings were sent again." });
  });
  return {
    name: "Touch Trackpad",
    titleView: <Title />,
    content: (
      <ErrorBoundary>
        <BasicPanel />
      </ErrorBoundary>
    ),
    icon: <Icon />,
    onDismount() {
      stopTracking();
      removeEventListener("daemon_restarted", onRestart);
      forgetPanelState();
    },
  };
});
