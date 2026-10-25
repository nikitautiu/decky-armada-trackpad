# Touch Trackpad (decky-armada-trackpad)

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for
[armada-trackpad-daemon](https://github.com/nikitautiu/armada-trackpad-daemon), which turns a handheld's touchscreen
into Steam Deck trackpads. From the Quick Access menu it switches the trackpads on and off, picks and tunes the left
and right pad, and keeps settings per game.

It shows up as **Touch Trackpad** in the Quick Access menu; the plugin folder and the repository are named
`decky-armada-trackpad`, and so is the release zip, with its version.

> **Support:** it runs on the devices in the table below, the ones the daemon supports, and is tested there. It
> relies on Steam UI behaviour that no API documents, so a Steam, Decky or SteamOS update can break parts of it.
> Please report problems in the [issue tracker](https://github.com/nikitautiu/decky-armada-trackpad/issues).

## Requirements

- **The trackpad daemon,** [armada-trackpad-daemon](https://github.com/nikitautiu/armada-trackpad-daemon), installed
  separately and before the plugin. Its [install steps](https://github.com/nikitautiu/armada-trackpad-daemon#install)
  run its installer as your user, plus a one-time step that needs `sudo` (InputPlumber configuration and a few
  system units). The plugin itself needs no root.
- **A daemon of a matching protocol.** When the daemon and the plugin don't fit together, the panel says which one to
  update and shows the daemon's version.
- **Decky Loader 3.**

### Supported devices

| Device | OS |
|---|---|
| Retroid Pocket Nova | Armada OS, game mode |

On any other device the panel says the device isn't supported, with the reason the daemon gives.

## Install

Until the plugin is listed in Decky's store, install it from a release:

1. Install the trackpad daemon as its [README](https://github.com/nikitautiu/armada-trackpad-daemon#install) says.
2. Download `decky-armada-trackpad-<version>.zip` from the
   [latest release](https://github.com/nikitautiu/decky-armada-trackpad/releases/latest).
3. In Decky's settings, turn on **Developer mode**, then in **Developer** choose **Install Plugin from ZIP File** and
   pick the zip (or **Install Plugin from URL** with the zip's release link).
4. Open the Quick Access menu and find **Touch Trackpad**.

The plugin's backend runs as your user, not as root, and talks only to the daemon.

## Update

Install the newer release's zip the same way; Decky replaces the plugin and your profiles stay. When a new plugin
release needs a newer daemon, the panel says so: update the daemon as its README describes.

## Uninstall

In Decky's settings, open **Plugins**, then the menu (**…**) of **Touch Trackpad**, and choose **Uninstall**. Your
profiles stay in `~/homebrew/settings/decky-armada-trackpad/`; delete that folder to remove them too. The daemon
has its own [uninstall steps](https://github.com/nikitautiu/armada-trackpad-daemon#uninstall).

## What the panel does

- **Trackpads:** while a game runs, turns its pads on or off right now. This lasts until the game exits; the
  daemon's toggle key or chord in the game does the same.
- **Profiles:** one global profile, and optionally one per game (**Use per-game profile**, as in Steam's Performance
  settings). Games without their own profile use the global one. **Start with trackpads on** is the profile's default
  when a game starts.
- **Pads:** the left and right pad are each Off, Pad, Radial, Swipe or Stick (Custom when Advanced settings match
  none), with a help page under the (i).
- **Size and position:** pad size (up to the largest pad that fits) and its vertical and horizontal position.
- **Preview:** an animation of how the pads react to touches with the current settings.
- **Advanced:** each pad's start, edges, tap click and drag, what a tap sends, the drag window, and the toggle key
  and chord. **Inspect** lists every daemon setting and status field as the daemon reports them, with a copy button.
- **Reset:** a pad or every setting back to the plugin's defaults, after a confirmation.
- **When the trackpads can't turn on:** the daemon's reason (such as the controller's wiring) and **Check again**.
- **When the daemon isn't there:** the panel offers to start it and shows its status, says how to install it, or
  says which side to update when they don't fit together. A daemon restart gets the settings sent again.

Profiles are stored in `~/homebrew/settings/decky-armada-trackpad/profiles.json`. An unreadable file is kept next to
it as `profiles.json.bad`, never silently replaced.

## Limitations

- The pads only work in a game. In Steam's own UI (library, Quick Access menu, Steam menu) the touchscreen stays a
  touchscreen, and the toggle key and chord do nothing there.
- At most 200 per-game profiles.
- Uninstalling the plugin leaves the daemon's last focus rules in place until the daemon restarts, so a game can
  still turn its pads on until then.
- A Steam, Decky or SteamOS update can break parts of the panel, since it relies on Steam UI behaviour that no API
  documents.

## Development

[CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the checks, the code and test conventions, the backend's
security model and how a release is built.

Development of this project was assisted by large language models (LLMs); all changes are reviewed and tested by the
maintainer.

## License

MIT, see [LICENSE](LICENSE).
