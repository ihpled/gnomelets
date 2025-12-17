import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';
import Cogl from 'gi://Cogl'; // Necessario per i formati pixel

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Configuration constants
const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
const GRAVITY = 2;             // Vertical acceleration per frame
const WALK_SPEED = 3;          // Horizontal pixels per frame
const JUMP_VELOCITY = -20;     // Initial jump force (negative is up)

// State Machine Definitions for the Gnomelet
const State = {
    FALLING: 'FALLING',
    WALKING: 'WALKING',
    IDLE: 'IDLE',
    JUMPING: 'JUMPING'
};

function isWindowMaximized(window) {
    return window.maximized_horizontally && window.maximized_vertically;
}

/**
 * Gnomelet Class
 * Represents a single animated kitten on the screen.
 * REFACTOR: Uses Pre-sliced Clutter.Images instead of Canvas or CSS.
 * This avoids VM/Wayland clipping bugs AND avoids Clutter.Canvas constructor issues.
 */
const Gnomelet = GObject.registerClass(
    class Gnomelet extends GObject.Object {
        _init(pixbuf, sheetWidth, sheetHeight, settings) {
            super._init();

            this._settings = settings;

            // --- Initialization ---
            // Start falling from the top of the screen at a random X position
            this._state = State.FALLING;
            this._vx = 0; // Velocity X
            this._vy = 0; // Velocity Y

            // --- Animation State ---
            this._frame = 0; // Current sprite frame index
            this._animationTimer = 0; // Counter for animation timing
            this._savedFacing = Math.random() > 0.5; // Initial Direction (replaces _facingRight)
            this._idleTimer = 0; // Countdown for how long to sit idle

            // --- Configurable Dimensions ---
            // We calculate the optimal display size based on the source image size
            // ensuring high quality and correct aspect ratio for a ~64px height.
            this._sheetWidth = sheetWidth;
            this._sheetHeight = sheetHeight;
            this._frameWidth = sheetWidth / 6; // Assuming 6 frames horizontally
            this._frameHeight = sheetHeight;

            const TARGET_HEIGHT = this._settings.get_int('gnomelet-scale');
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            this._randomizeStartPos();

            // --- Texture Preparation (Slice the Atlas) ---
            // We create 6 Clutter.Images, one for each frame.
            this._frameImages = [];

            try {
                const hasAlpha = pixbuf.get_has_alpha();
                const pixelFormat = hasAlpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888;
                const nChannels = hasAlpha ? 4 : 3;
                const rowStride = pixbuf.get_rowstride();

                for (let i = 0; i < 6; i++) {
                    // Create a sub-buffer for this frame (no copy, just reference)
                    let srcX = i * this._frameWidth;
                    let subPixbuf = pixbuf.new_subpixbuf(srcX, 0, this._frameWidth, this._frameHeight);

                    // Create a Clutter.Image content
                    let img = new Clutter.Image();

                    // Upload pixel data to GPU
                    // Note: new_subpixbuf shares data, but get_pixels() returns the pointer.
                    // However, we need to point to the start of the subpixbuf.
                    // Actually, subpixbuf.get_pixels() returns the correct offset pointer in C,
                    // and GJS maps it to a Uint8Array. 
                    // Clutter.Image.set_data handles the copy.

                    let success = img.set_data(
                        subPixbuf.get_pixels(),
                        pixelFormat,
                        this._frameWidth,
                        this._frameHeight,
                        subPixbuf.get_rowstride()
                    );

                    if (success) {
                        this._frameImages.push(img);
                    } else {
                        console.error(`[Gnomelets] Failed to create texture for frame ${i}`);
                        this._frameImages.push(null); // Placeholder
                    }
                }
            } catch (e) {
                console.error(`[Gnomelets] Error preparing textures: ${e.message}`);
            }

            // --- Actor Setup ---
            this.actor = new Clutter.Actor({
                visible: true,
                reactive: false,
                width: this._displayW,
                height: this._displayH,
                content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
            });

            // Set initial content
            if (this._frameImages.length > 0 && this._frameImages[0]) {
                this.actor.set_content(this._frameImages[0]);
            }

            // --- Initial Placement ---
            // Add to the Shell's generic UI layer (Chrome) initially.
            Main.layoutManager.addChrome(this.actor);
            this.actor.set_position(this._x, this._y);

            this._updateAnimation();
        }

        // Property to define facing based on Velocity X
        // Automatically updates saved facing when moving, otherwise returns last direction.
        get facingRight() {
            let sign = Math.sign(this._vx);
            if (sign !== 0 && !isNaN(sign)) {
                this._savedFacing = (sign > 0);
            }
            return this._savedFacing;
        }

        updateScale() {
            let oldH = this._displayH;

            const TARGET_HEIGHT = this._settings.get_int('gnomelet-scale');
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            // Update Actors
            // Container
            this.actor.set_width(this._displayW);
            this.actor.set_height(this._displayH);

            // Adjust Y position so feet stay at the same level
            this._y = this._y + oldH - this._displayH;
            this.actor.set_position(this._x, this._y);
        }

        serialize() {
            return {
                x: this._x,
                y: this._y,
                vx: this._vx,
                vy: this._vy,
                state: this._state,
                facing: this._savedFacing,
                idleTimer: this._idleTimer
            };
        }

        deserialize(data) {
            if (!data) return;
            if (data.x !== undefined) this._x = data.x;
            if (data.y !== undefined) this._y = data.y;
            if (data.vx !== undefined) this._vx = data.vx;
            if (data.vy !== undefined) this._vy = data.vy;
            if (data.state !== undefined) this._state = data.state;
            if (data.facing !== undefined) this._savedFacing = data.facing;
            if (data.idleTimer !== undefined) this._idleTimer = data.idleTimer;

            this.actor.set_position(this._x, this._y);
        }

        /**
         * Main update loop for the gnomelet.
         * Called by GnomeletManager every tick.
         * @param {Array} windows - List of visible windows to interact with.
         */
        update(windows) {
            if (!this.actor) return; // Guard against updates after destruction

            // Physics (Gravity)
            if (this._state === State.FALLING || this._state === State.JUMPING) {
                this._vy += GRAVITY;
            }

            // Stop movement if idle (prevents sliding)
            if (this._state === State.IDLE) {
                this._vx = 0;
            }

            // Update Position
            let prevY = this._y;
            this._x += this._vx;
            this._y += this._vy;

            // Determine current monitor
            let feetX = this._x + this._displayW / 2;
            let feetY = this._y + this._displayH;

            // Find monitors strictly containing X
            let monitors = Main.layoutManager.monitors.filter(m => feetX >= m.x && feetX < m.x + m.width);

            let currentMonitor = null;
            if (monitors.length === 0) {
                // Out of bounds? Use Primary
                currentMonitor = Main.layoutManager.primaryMonitor;
            } else if (monitors.length === 1) {
                currentMonitor = monitors[0];
            } else {
                // Multiple stacked vertically. Find the one we are "in" or just fell through.
                // We want the monitor where feetY is within [y, y + height]
                // OR if feetY > y + height (just passed), but feetY < next_monitor.y?

                // Let's sort by Y
                monitors.sort((a, b) => a.y - b.y);

                // Find first monitor where we are ABOVE the floor?
                // No, we want the monitor that encloses us.
                currentMonitor = monitors.find(m => feetY < m.y + m.height);

                // If we are past the last monitor's floor (currentMonitor is undefined),
                // it implies we fell off the world bottom.
                // We should probably snap to the last one.
                if (!currentMonitor) currentMonitor = monitors[monitors.length - 1];
            }

            let floorY = currentMonitor.y + currentMonitor.height;

            // --- Logic: Reposition on Floor Exit ---
            // If the gnomelet is on the "floor" and walks off-screen, respawn it at the top.
            let onFloorLevel = (this._y + this._displayH) >= floorY - 10;

            if (onFloorLevel) {
                // Check if completely outside horizontal bounds
                if (this._x < -this._displayW || this._x > global.stage.width) {
                    this._respawn();
                    return; // Skip rest of frame
                }
            } else {
                // Routine Wall Bounce on windows/air
                let maxX = global.stage.width - this._displayW;
                if (this._x < 0) {
                    this._x = 0;
                    this._vx *= -1; // Just flip velocity, facing updates automatically
                } else if (this._x > maxX) {
                    this._x = maxX;
                    this._vx *= -1;
                }
            }


            // --- Collision Detection ---
            let onGround = false;
            let landedOnWindow = null;

            if (this._vy >= 0) { // Only collide if falling downwards
                // Check against all windows
                for (let win of windows) {
                    let rect = win.rect;

                    // Hitbox: Feet within window width AND close to top edge
                    // We use prevY to check if we *crossed* the threshold to prevent tunneling at high speeds
                    let prevFeetY = prevY + this._displayH;
                    let inHorizontalRange = (feetX >= rect.x) && (feetX <= rect.x + rect.width);
                    let inVerticalRange = (feetY >= rect.y) && (prevFeetY <= rect.y + 25);

                    if (inHorizontalRange && inVerticalRange) {
                        // Landed!
                        this._y = rect.y - this._displayH + 1; // +1 to prevent floating
                        this._vy = 0;
                        onGround = true;
                        landedOnWindow = win;
                        break;
                    }
                }

                // Allow landing on screen bottom (Floor)
                if (!landedOnWindow) {
                    if (feetY >= floorY) {
                        this._y = floorY - this._displayH;
                        this._vy = 0;
                        onGround = true;
                    }
                }
            }

            // --- Z-Ordering / Layering Logic ---
            // This is complex because we want gnomelets to stand ON windows (appear in front of them),
            // but arguably BEHIND windows that are covering the one they stand on.

            if (landedOnWindow) {
                // 1. Landing on a Window:
                // Move the gnomelet actor into the global 'window_group'.
                // This allows us to use 'set_child_above_sibling' to place it essentially
                // on the same layer stack as the windows themselves.

                let parent = this.actor.get_parent();
                if (parent !== global.window_group) {
                    // Cleanly remove from previous container
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent === Main.layoutManager._backgroundGroup) {
                        parent.remove_child(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    global.window_group.add_child(this.actor);
                }
                // Ensure it is just above the window it landed on
                global.window_group.set_child_above_sibling(this.actor, landedOnWindow.actor);

            } else if (onGround && !landedOnWindow) {
                // 2. Landing on the Floor:
                // Behavior depends on user settings ('Front' or 'Back').

                let floorMode = this._settings.get_string('floor-z-order');
                let parent = this.actor.get_parent();

                if (floorMode === 'front') {
                    // 'Front': Default Overlay mode. 
                    // Put in 'uiGroup' (Chrome), which is above everything.
                    if (parent !== Main.layoutManager.uiGroup) {
                        if (parent) {
                            parent.remove_child(this.actor);
                        }
                        Main.layoutManager.addChrome(this.actor);
                    }
                } else {
                    // 'Back': Desktop mode.
                    // We want it behind all windows but above the wallpaper.
                    // We use '_backgroundGroup' (the container for desktop icons/background).
                    // It's a private property in newer Shell versions, so we attempt access.
                    let bgGroup = Main.layoutManager._backgroundGroup;

                    if (bgGroup && parent !== bgGroup) {
                        // Remove from UI/Window group
                        if (parent === Main.layoutManager.uiGroup) {
                            Main.layoutManager.removeChrome(this.actor);
                        } else if (parent) {
                            parent.remove_child(this.actor);
                        }
                        // Add to background
                        bgGroup.add_child(this.actor);
                    }
                }
            }

            // --- State Machine Transitions ---
            if (onGround) {
                // Just landed?
                if (this._state === State.FALLING || this._state === State.JUMPING) {
                    this._vy = 0;
                    this._pickNewAction(); // Decide whether to walk or sit, and set the state accordingly
                }
            } else {
                // In air
                if (this._state !== State.JUMPING) {
                    this._state = State.FALLING;
                }
            }

            // --- AI Behavior ---
            if (this._state === State.WALKING) {
                // Maintain current velocity (direction set by _pickNewAction)
                this._idleTimer = 0;

                // Small chance to stop walking
                if (Math.random() < 0.02) {
                    this._state = State.IDLE;
                    this._vx = 0;
                    this._idleTimer = Math.random() * 60 + 20; // 1-3 seconds
                }
                // Very small chance to jump
                if (Math.random() < 0.01) {
                    this._performJump();
                }
            } else if (this._state === State.IDLE) {
                this._vx = 0;
                this._idleTimer--;
                if (this._idleTimer <= 0) {
                    this._pickNewAction(); // Time to move again
                }
            }

            this._updateAnimation();
            this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
        }

        _randomizeStartPos() {
            let monitors = Main.layoutManager.monitors;
            if (!monitors || monitors.length === 0) {
                this._x = Math.floor(Math.random() * (global.stage.width - this._displayW));
                this._y = 0;
            } else {
                let m = monitors[Math.floor(Math.random() * monitors.length)];
                this._x = Math.floor(m.x + Math.random() * (m.width - this._displayW));
                this._y = m.y;
            }
        }

        _respawn() {
            // Reset to top to fall again
            this._randomizeStartPos();
            this._vx = 0;
            this._vy = 0;
            this._state = State.FALLING;

            // Ensure visibility by moving back to Chrome layer
            let parent = this.actor.get_parent();
            if (parent !== Main.layoutManager.uiGroup) {
                if (parent) parent.remove_child(this.actor);
                Main.layoutManager.addChrome(this.actor);
            }
        }

        _pickNewAction() {
            let r = Math.random();
            if (r < 0.6) {
                this._state = State.WALKING;
                // Set velocity directly based on random choice
                let dir = (Math.random() > 0.5) ? 1 : -1;
                this._vx = dir * WALK_SPEED;
            } else {
                this._state = State.IDLE;
                this._idleTimer = Math.random() * 60 + 20;
            }
        }

        _performJump() {
            this._state = State.JUMPING;
            this._vy = JUMP_VELOCITY;
            // Keep current facing direction
            let dir = this.facingRight ? 1 : -1;
            this._vx = dir * WALK_SPEED * 2;
        }

        _updateAnimation() {
            this._animationTimer++;
            let frameIndex = 0;
            // Map states to sprite frames
            switch (this._state) {
                case State.WALKING:
                    let walkFrames = [0, 1, 2, 3];
                    let speed = 4; // Change frame every 4 ticks
                    let idx = Math.floor(this._animationTimer / speed) % walkFrames.length;
                    frameIndex = walkFrames[idx];
                    break;
                case State.IDLE:
                    frameIndex = 4;
                    break;
                case State.JUMPING:
                case State.FALLING:
                    frameIndex = 5;
                    break;
            }
            this.setFrame(frameIndex);
        }

        setFrame(frameIndex) {
            if (this._frame === frameIndex && this._lastFacing === this.facingRight) return;

            this._frame = frameIndex;
            this._lastFacing = this.facingRight;

            // Swap the content to the pre-loaded Clutter.Image for this frame
            if (this._frameImages && this._frameImages[frameIndex]) {
                this.actor.set_content(this._frameImages[frameIndex]);
            }

            // Facing via Actor scaling (mirroring)
            this.actor.set_pivot_point(0.5, 0.5);
            if (this.facingRight) {
                this.actor.scale_x = 1;
            } else {
                this.actor.scale_x = -1;
            }
        }

        destroy() {
            if (this.actor) {
                // Clean up from whichever parent it is currently in
                let parent = this.actor.get_parent();
                if (parent === Main.layoutManager.uiGroup) {
                    Main.layoutManager.removeChrome(this.actor);
                } else if (parent) {
                    parent.remove_child(this.actor);
                }
                this.actor.destroy();
                this.actor = null;
            }
            this._frameImages = [];
        }
    });

/**
 * GnomeletManager Class
 * Orchestrates the lifecycle of all gnomelets.
 */
class GnomeletManager {
    constructor(settings) {
        this._gnomelets = [];
        this._settings = settings;
        this._windows = [];
        this._timerId = 0;
        this._imagePath = null;
        this._pixbuf = null; // Store loaded pixbuf
        this._imgW = 0;
        this._imgH = 0;
        this._cacheFile = GLib.get_user_cache_dir() + '/gnomelets-state.json';

        this._updateImageSource();
    }

    _updateImageSource() {
        let type = this._settings.get_string('gnomelet-type');
        if (!type) type = 'kitten';

        let file = Gio.File.new_for_uri(import.meta.url);
        let dir = file.get_parent();
        let imageFile = dir.get_child('images').get_child(`${type}.png`);
        this._imagePath = imageFile.get_path();

        try {
            // Keep the Pixbuf in memory to pass to Gnomelets for drawing
            this._pixbuf = GdkPixbuf.Pixbuf.new_from_file(this._imagePath);
            this._imgW = this._pixbuf.get_width();
            this._imgH = this._pixbuf.get_height();
            console.log(`[Gnomelets] Loaded image for ${type}: ${this._imgW}x${this._imgH}`);
        } catch (e) {
            console.error(`[Gnomelets] Failed to load image info for ${type}: ${e.message}`);
            this._pixbuf = null;
            this._imgW = 0;
            this._imgH = 0;
        }
    }

    enable() {
        if (!this._pixbuf) return;

        // Listen for changes
        this._settingsSignal = this._settings.connect('changed', (settings, key) => {
            if (key === 'gnomelet-count') {
                this._updateCount();
            } else if (key === 'gnomelet-scale') {
                this._updateScale();
            } else if (key === 'gnomelet-type') {
                this._updateImageSource();
                this._hardReset();
            } else if (key === 'reset-trigger') {
                this._hardReset();
            }
        });

        // Load saved state if available
        let savedState = this._loadState();
        this._spawnGnomelets(savedState);

        // Start the Main Loop
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        // Save current state before destroying
        this._saveState();

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = 0;
        }

        this._destroyGnomelets();
        this._pixbuf = null; // Free memory
    }

    _loadState() {
        try {
            if (GLib.file_test(this._cacheFile, GLib.FileTest.EXISTS)) {
                let [success, contents] = GLib.file_get_contents(this._cacheFile);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    let json = decoder.decode(contents);
                    let data = JSON.parse(json);
                    return data;
                }
            }
        } catch (e) {
            console.warn(`[Gnomelets] Failed to load state: ${e.message}`);
        }
        return null; // No saved state
    }

    _saveState() {
        try {
            let data = this._gnomelets.map(p => p.serialize());
            let json = JSON.stringify(data);
            GLib.file_set_contents(this._cacheFile, json);
        } catch (e) {
            console.warn(`[Gnomelets] Failed to save state: ${e.message}`);
        }
    }

    _updateScale() {
        for (let p of this._gnomelets) {
            p.updateScale();
        }
    }

    _hardReset() {
        this._destroyGnomelets();

        // Delete cache file to prevent restoring old state
        try {
            let f = Gio.File.new_for_path(this._cacheFile);
            if (f.query_exists(null)) {
                f.delete(null);
            }
        } catch (e) {
            console.warn(`[Gnomelets] Failed to delete cache: ${e.message}`);
        }

        this._spawnGnomelets(null);
    }

    _updateCount() {
        let count = this._settings.get_int('gnomelet-count');
        let current = this._gnomelets.length;

        if (count > current) {
            // Add new gnomelets
            for (let i = 0; i < (count - current); i++) {
                let p = new Gnomelet(this._pixbuf, this._imgW, this._imgH, this._settings);
                this._gnomelets.push(p);
            }
        } else if (count < current) {
            // Remove gnomelets
            for (let i = 0; i < (current - count); i++) {
                let p = this._gnomelets.pop();
                p.destroy();
            }
        }
    }

    _spawnGnomelets(savedState) {
        // Spawn gnomelets based on user setting
        let count = this._settings.get_int('gnomelet-count');
        for (let i = 0; i < count; i++) {
            let p = new Gnomelet(this._pixbuf, this._imgW, this._imgH, this._settings);
            if (savedState && savedState[i]) {
                p.deserialize(savedState[i]);
            }
            this._gnomelets.push(p);
        }
    }

    _destroyGnomelets() {
        for (let p of this._gnomelets) {
            p.destroy();
        }
        this._gnomelets = [];
    }

    _tick() {
        // Wrap tick in try-catch to prevent extension crash from transient errors
        try {
            this._windows = [];
            let focusWindow = global.display.focus_window;
            let maximizedFocused = focusWindow && isWindowMaximized(focusWindow);

            if (!maximizedFocused) {
                // Gather all visible windows from the shell
                // We use global.window_group to get the actual Actor hierarchy
                let actors = global.window_group.get_children();
                for (let actor of actors) {
                    if (!actor.visible) continue;

                    // Only care about actors that have a MetaWindow (real application windows)
                    if (actor.meta_window) {
                        let rect = actor.meta_window.get_frame_rect();
                        if (actor.meta_window.minimized) continue;
                        // Skip maximized windows to prevent gnomelets from being hidden/off-screen
                        if (isWindowMaximized(actor.meta_window)) continue;

                        this._windows.push({
                            rect: rect,
                            actor: actor
                        });
                    }
                }
            }

            // Update individual gnomelets
            for (let p of this._gnomelets) {
                p.update(this._windows);
            }
        } catch (e) {
            console.error(`[Gnomelets] Error: ${e.message}`);
        }
    }
}

/**
 * Extension Entry Point
 */
export default class DesktopGnomeletsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._manager = new GnomeletManager(this._settings);
        this._manager.enable();
    }

    disable() {
        if (this._manager) {
            this._manager.disable();
            this._manager = null;
        }
        this._settings = null;
    }
}