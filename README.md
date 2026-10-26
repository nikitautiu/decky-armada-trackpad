# Touch Trackpad

[![Demo: switching between touchscreen and trackpad mode in a game](docs/media/demo.webp)](docs/media/demo.mp4)

Touch Trackpad turns your handheld's touchscreen into Steam Deck trackpads. Each half of the screen acts as one of
the Deck's trackpads, and Steam Input maps it like the real one: mouse, joystick, scroll wheel or radial menu. One
button switches back to the normal touchscreen.

It's a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin, the Quick Access panel for
[armada-trackpad-daemon](https://github.com/nikitautiu/armada-trackpad-daemon). It runs on the Retroid Pocket Nova
with Armada OS, in game mode.

## Install

1. Install the daemon on the device. Its [README](https://github.com/nikitautiu/armada-trackpad-daemon#install)
   explains each step.

   ```sh
   git clone https://github.com/nikitautiu/armada-trackpad-daemon
   cd armada-trackpad-daemon
   ./install.sh
   sudo ./scripts/system-files.sh install
   ```

2. Download `decky-armada-trackpad-<version>.zip` from the
   [latest release](https://github.com/nikitautiu/decky-armada-trackpad/releases/latest).
3. In Decky's settings, turn on **Developer mode**. Under **Developer**, pick **Install Plugin from ZIP File** and
   choose the zip.

## Use

1. Start a game, open **Touch Trackpad** in the Quick Access menu and turn on **Trackpads**. The trackpads work in
   games only. Steam's own menus keep the touchscreen.
2. In the game's controller layout, bind a button to the key **Insert** (on the **Numpad** tab of Steam's key
   picker). That button switches between trackpad and touchscreen. Set **Left Trackpad** and **Right Trackpad** to
   what the game needs.
3. Pick a mode for each pad in the panel:
   - **Pad** stays in one spot, like the Deck's trackpad.
   - **Radial** starts where you touch, for radial menus.
   - **Swipe** recenters under your finger at an edge, for mouse and camera.
   - **Stick** follows your finger past an edge.

[Issues](https://github.com/nikitautiu/decky-armada-trackpad/issues) ·
[Contributing](CONTRIBUTING.md) · MIT [license](LICENSE) · Large language models (LLMs) assisted the development of
this project. The maintainer reviews and tests every change.
