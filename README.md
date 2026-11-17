# Gnomelets 🎅

Brighten up your GNOME desktop with **Gnomelets**! This extension brings small, animated 2D characters to life, letting them roam freely across your screen. They walk, jump, and even balance on top of your open windows.


Watch as they fall from the top of the screen, land on your active windows, and explore your desktop environment with charming pixel-art animations.

https://github.com/user-attachments/assets/2a6e47ec-c063-4d65-87ba-e7559144d641

## Features

*   **Custom Characters**: Easily add your own pixel-art characters.
*   **Physics-based Movement**: Gnomelets obey gravity, falling naturally and landing on solid surfaces.
*   **Window Interaction**: They detect open windows and can walk along their title bars and top edges.
*   **Pixel-Art Animations**: Smooth idle, walking, jumping, and falling animations.
*   **State Persistence**: Gnomelets remember where they were even after you restart the shell or disable/enable the extension.
*   **Multi-Monitor Support**: They can travel and spawn across all your connected screens.
*   **Smart AI Behavior**: Gnomelets employ intelligent jumping mechanics, detecting edges to perform daring leaps and predicting reachable windows to climb upwards dynamically.
*   **Top Bar Controls**: A convenient menu in the top bar lets you instantly re-spawn all gnomelets or toggle their visibility on/off without opening settings.
*   **Interactive Drag & Drop with Momentum**: Pick up gnomelets with your mouse and toss them! They now support physics-based throwing—release them while moving the mouse to fling them across the screen.
*   **Dash to Dock (Ubuntu Dock) & Dash to Panel Support**: Gnomelets can now recognize, land on, and explore both Dash to Dock (Ubuntu Dock) and Dash to Panel if they are present on your screen!

## Configuration

You can customize your experience via the extension settings:

*   **Character Selection**: Select one or more characters (e.g., Kitten, Santa Claus, etc.) from the list. If multiple are selected, they will appear randomly! The list automatically updates with any new folders found in the `images` directory.
*   **Population Control**: Decide how many gnomelets you want roaming your screen at once.
*   **Scale**: Adjust the size of the characters to fit your screen resolution or preference.
*   **In Front of Maximized**: Choose whether gnomelets walk in front of your windows or behind them. Use **Partial** or **Disallow** for a "distraction-free" experience: Partial intelligently hides gnomelets only when a maximized (or full-screen) window is focused, while Disallow keeps them hidden behind maximized/full-screen windows.
*   **Dock Support**: Explicitly select "Dash to Dock (Ubuntu Dock)", "Dash to Panel", or "None" to optimize interaction.
*   **Allows Interaction**: Now you can enable/disable the ability to drag and drop gnomelets with your mouse!
*   **Jump Power**: Configure the vertical jump strength to make gnomelets hop higher or lower.
*   **Spawn Offset from Top**: Customize the vertical offset from the top of the screen where gnomelets spawn.

## Claude Agent Pet

An optional, interactive pet (folder `images/Claude`) that lives alongside your regular gnomelets and can react to your Claude session. Its count is independent of the regular gnomelet settings (default 1, set to 0 to disable).

### Interactions

*   **Click**: a happy hop with pixel sparkles and a speech bubble (a random developer quip, or the live session message if one is active).
*   **Double click**: opens a prompt bubble (if chat is enabled). Enter sends, Esc or `x` closes.
*   **Hold and move (more than 8px)**: drag the pet; release to toss it. It then lands on a window top edge or the screen bottom.
*   **Right click**: menu with *Ask Claude...*, *Spawn Claude Pet*, *Dismiss Pet* and a *Focus Mode* switch.
*   The Claude pet is always clickable, regardless of the *Allow Interaction* setting (which only affects regular gnomelets).

### States

Walking, idle, jumping/falling, climbing (while jumping up towards a window), sitting, dragged, typing, thinking, happy and sleeping (after about 60 seconds without interaction; any interaction wakes it). In **Focus Mode** the pet stays perched on window top edges without walking or random jumps.

### Asking Claude

The prompt runs `claude -p "<your text>"` headless in your home directory, asynchronously and without a shell, with a 120 second timeout. The pet shows *thinking* and then *typing* while it waits, and the answer appears in a scrollable bubble with Copy and Close buttons (output is capped at about 8000 characters, errors at about 600). The binary is looked up in `PATH` and then in `~/.local/bin`, `/usr/local/bin`, `~/.npm-global/bin` and `/usr/bin`. It runs with the CLI's own permission model; the extension never passes `--dangerously-skip-permissions`. Only one request per pet runs at a time.

### Session state file

Any tool (for example a Claude Code hook) can drive the pet by writing JSON to `/tmp/gnomelets-claude-state.json`:

```
echo '{"state":"typing","message":"Running tests..."}' > /tmp/gnomelets-claude-state.json
```

*   `state` must be one of `thinking`, `typing`, `done`, `error`. `message` (optional) must be a string and is shown in the speech bubble.
*   `thinking` and `typing` persist until the next update; `done` (happy) and `error` (sad) return to normal after about 4 seconds.
*   Applies to all Claude pets. Identical consecutive payloads are ignored; the file is only watched while it changes (a stale file from before login is not replayed).
*   Disable with the *Sync With Claude Session* setting.

### Settings

*   **Number of Claude Pets** (0 to 5), **Enable Claude Chat**, **Focus Mode** and **Sync With Claude Session**, in the *Claude Agent Pet* group of the preferences.

### Security notes

*   The state file lives in world-writable `/tmp` and is **untrusted**: it is size-limited, parsed as JSON, validated, stripped of control characters, capped at 200 characters and shown as plain text only (never markup). It can only change the pet's mood and speech bubble.
*   Chat sends your prompt to the local `claude` CLI, which uses your account and its own permission prompts/settings in headless mode. Turn off *Enable Claude Chat* if you do not want the extension to launch it.

## Adding Custom Characters

Want to add your own character? It's easy!

1.  Navigate to the extension's `images` folder (usually in `~/.local/share/gnome-shell/extensions/gnomelets@.../images`).
2.  Create a new folder with your character's name (e.g., `Robot`).
3.  Add the PNG animation frames inside that folder:
    *   **0.png - 3.png**: Walking animation frames.
    *   **4.png**: Idle frame.
    *   **5.png**: Jumping/Falling frame.
    *   **6.png - 7.png**: (Optional) Dragging animation frames. If missing, frames `1.png` and `3.png` are used.
4.  (Optional) Extended frames, used by the Claude pet and any character that provides them. Missing frames are simply skipped, and characters with only `0.png - 7.png` keep working unchanged:
    *   **8.png - 11.png**: Typing. **12.png - 15.png**: Thinking. **16.png - 19.png**: Happy. **20.png - 23.png**: Sleeping.
    *   **24.png - 25.png**: Sitting. **26.png - 29.png**: Climbing. **30.png**: Jumping up. **31.png**: Falling.
5.  Reload the extension or restart GNOME Shell. Your new character will appear in the settings dropdown!

## Installation

1.  Download the extension.
2.  Install it via `gnome-extensions install` or copy the folder to `~/.local/share/gnome-shell/extensions/`.
3.  Enable it using the Extensions app or `gnome-extensions enable`.
4.  Open the settings to choose your favorite Gnomelet!

---
*Created with ❤️ for the GNOME community.*
