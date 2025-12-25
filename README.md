# Gnomelets 🎅

Brighten up your GNOME desktop with **Gnomelets**! This extension brings small, animated 2D characters to life, letting them roam freely across your screen. They walk, jump, and even balance on top of your open windows.


Watch as they fall from the top of the screen, land on your active windows, and explore your desktop environment with charming pixel-art animations.

https://github.com/user-attachments/assets/2a6e47ec-c063-4d65-87ba-e7559144d641

## 🎄 Christmas Special Edition 🎄

**Ho Ho Ho!**
In the spirit of the holiday season, we have added a special guest: **Santa Claus**! 
You can now select Santa as your desktop companion to bring some festive cheer to your workflow.

## Features

*   **Custom Characters**: Easily add your own pixel-art characters.
*   **Physics-based Movement**: Gnomelets obey gravity, falling naturally and landing on solid surfaces.
*   **Window Interaction**: They detect open windows and can walk along their title bars and top edges.
*   **Pixel-Art Animations**: Smooth idle, walking, jumping, and falling animations.
*   **State Persistence**: Gnomelets remember where they were even after you restart the shell or disable/enable the extension.
*   **Multi-Monitor Support**: They can travel and spawn across all your connected screens.
*   **Smart AI Behavior**: Gnomelets employ intelligent jumping mechanics, detecting edges to perform daring leaps and predicting reachable windows to climb upwards dynamically.
*   **Top Bar Controls**: A convenient menu in the top bar lets you instantly re-spawn all gnomelets or toggle their visibility on/off without opening settings.
*   **Interactive Drag & Drop**: Pick up gnomelets with your mouse and move them around! Enable interaction in settings to drag them to new locations.
*   **Dash to Dock (Ubuntu Dock) & Dash to Panel Support**: Gnomelets can now recognize, land on, and explore both Dash to Dock (Ubuntu Dock) and Dash to Panel if they are present on your screen!

## Configuration

You can customize your experience via the extension settings:

*   **Character Selection**: Select one or more characters (e.g., Kitten, Santa Claus, etc.) from the list. If multiple are selected, they will appear randomly! The list automatically updates with any new folders found in the `images` directory.
*   **Population Control**: Decide how many gnomelets you want roaming your screen at once.
*   **Scale**: Adjust the size of the characters to fit your screen resolution or preference.
*   **In Front of Maximized**: Choose whether gnomelets walk in front of your windows or behind them. Use **Partial** or **Disallow** for a "distraction-free" experience: Partial intelligently hides gnomelets only when a maximized window is focused, while Disallow keeps them hidden behind maximized windows.
*   **Dock Support**: Explicitly select "Dash to Dock (Ubuntu Dock)", "Dash to Panel", or "None" to optimize interaction.
*   **Allow Interaction**: Now you can enable/disable the ability to drag and drop gnomelets with your mouse!

## Adding Custom Characters

Want to add your own character? It's easy!

1.  Navigate to the extension's `images` folder (usually in `~/.local/share/gnome-shell/extensions/gnomelets@.../images`).
2.  Create a new folder with your character's name (e.g., `Robot`).
3.  Add the PNG animation frames inside that folder:
    *   **0.png - 3.png**: Walking animation frames.
    *   **4.png**: Idle frame.
    *   **5.png**: Jumping/Falling frame.
    *   **6.png - 7.png**: (Optional) Dragging animation frames. If missing, frames `1.png` and `3.png` are used.
4.  Reload the extension or restart GNOME Shell. Your new character will appear in the settings dropdown!

## Installation

1.  Download the extension.
2.  Install it via `gnome-extensions install` or copy the folder to `~/.local/share/gnome-shell/extensions/`.
3.  Enable it using the Extensions app or `gnome-extensions enable`.
4.  Open the settings to choose your favorite Gnomelet!

---
*Created with ❤️ for the GNOME community.*
