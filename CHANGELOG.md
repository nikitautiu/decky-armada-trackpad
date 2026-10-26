# Changelog

This file lists the user-visible changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-26

### Added

- A Quick Access panel, **Touch Trackpad**, for armada-trackpad-daemon's control protocol 1.
- **Trackpads** switches the running game's pads on or off until it exits; the daemon's toggle key and chord do the
  same in the game. In Steam's own UI the touchscreen stays a touchscreen.
- A global profile and optional per-game profiles, each with its own settings and **Start with trackpads on**,
  stored in the plugin's settings folder and sent to the daemon again after it restarts.
- Left and right pad selectors (Off, Pad, Radial, Swipe, Stick), size and position sliders, an animated preview and
  a help page.
- Advanced settings per pad (start, edges, tap click and drag, tap output, drag window), the toggle key and chord,
  and an Inspect view of every daemon setting and status field, device and InputPlumber version included, with copy.
- Resets of a pad or of every setting to the plugin's defaults, after a confirmation.
- Notices for a daemon that isn't running (start it, show its status), isn't installed, speaks another protocol (which
  side to update, with the daemon's version), runs on an unsupported device, or can't turn the trackpads on (with the
  daemon's reason and **Check again**).
- A "Something went wrong" message with the error, instead of a blank panel or modal, when a view fails to render.
- Release zips built by CI for `v*` tags.

[0.1.0]: https://github.com/nikitautiu/decky-armada-trackpad/releases/tag/v0.1.0
