# Steam UI workarounds

The plugin works around some behaviour of Steam's UI, Decky Loader and gamescope that no API documents. Each
workaround is marked in the code with a `Steam UI workaround:` comment
(`grep -rn "Steam UI workaround" src py_modules`). Re-check them after a Steam, Decky or SteamOS update:

- **B after a modal:** the B press that closes a modal opened over a game arrives at the panel again as a second
  Back. The panel ignores B for 500 ms after a modal closes (`src/logic/backGuard.ts`, `useBackGuard`).
- **B in a sub-view:** the Quick Access menu closes the plugin on B unless the panel stops the event first.
  `swallowBack` calls both `preventDefault` and `stopPropagation`, because Steam doesn't document which one it honours.
- **Remount after a popup:** Decky unmounts the panel while a dropdown's list or a modal is open and mounts it
  again after, so the open view, pending dropdown picks, the control to refocus and the latest snapshot live outside
  React (`src/panel/hooks.ts`, `src/logic/picks.ts`, `src/state.ts`, `src/snapshots.ts`), with a 1 s grace for the
  remount.
- **Focus:** Steam starts a remounted or newly opened view at its first row and ignores DOM focus, so rows take
  focus with `autoFocus`/`preferredFocus` and again one animation frame later (`useFocusReturn`, `SubView`,
  `DropdownFocus`). The panel renders in Steam's menu window, not the plugin's own document.
- **Minimum widths:** Steam gives a slider's control a 270 px minimum width in the Quick Access menu (sliders are not
  indented) and its row buttons a 160 px one (the Tap buttons use `NoMinWidth`).
- **Pressed buttons:** a pressed Tap button's inline colour hides Steam's focus colour. The panel tracks the
  focused button itself and draws the focus on a group around each button, since Steam's navigation focuses the
  button (`TapRow` in `src/panel/AdvancedView.tsx`).
- **Compact padding:** Steam's compact row padding drops the side inset. Inspect's rows use the standard padding
  (`src/panel/InspectView.tsx`).
- **Plain focusable elements:** Steam's navigation stops only on an element with an activate handler. The status
  box gets a no-op `onActivate` for that reason.
- **Clipboard:** `execCommand("copy")` is tried before the async clipboard API, which Steam's browser may refuse.
- **Preview animation:** frames are requested from the drawing's own window; the plugin's global window is Steam's
  hidden shared context, where frames may not run.
- **Game icons:** the panel reads a game's icon URL from Steam's undocumented `appStore` (`GetIconURLForApp`, else
  the community icon path with its `icon_hash`). Its getters can throw while the library loads
  (`src/logic/gameIcon.ts`).
- **Running game:** Steam has no event for it, so `SteamUIStore.MainRunningAppID` and `Router.MainRunningApp` are
  polled every 250 ms (`src/game.ts`); the `Router` lookup can fail on another Steam build, and a store getter that
  throws makes the tick unreadable.
- **Undeclared props and wrapped callbacks:** `SliderField` reads `renderValue`, which `@decky/ui` doesn't declare;
  Decky wraps event callbacks, so a listener is removed with the handle `addEventListener` returned.
- **Steam's own UI in gamescope:** gamescope reports one focused app id, 769, for the library, the Quick Access
  menu, the Steam menu and the controller configurator (`STEAM_UI` in `focus.py`).
