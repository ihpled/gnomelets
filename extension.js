import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// --- Configuration Constants ---
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

/**
 * Utility to check if a window is maximized
 */
function isWindowMaximized(window) {
    return window.maximized_horizontally && window.maximized_vertically;
}

/**
 * Gnomelet Class
 * Represents a single animated character on the screen.
 * Uses pre-sliced images loaded by the Manager.
 */
const Gnomelet = GObject.registerClass(
    class Gnomelet extends GObject.Object {
        _init(frameImages, frameWidth, frameHeight, settings) {
            super._init();

            this._settings = settings;

            // --- State Initialization ---
            this._state = State.FALLING;
            this._vx = 0; // Velocity X
            this._vy = 0; // Velocity Y

            // --- Animation State ---
            this._frame = 0; // Current sprite frame index
            this._animationTimer = 0; // Counter for animation timing
            this._savedFacing = Math.random() > 0.5; // Initial Direction
            this._idleTimer = 0; // Countdown for how long to stay idle

            // --- Configurable Dimensions ---
            this._frameWidth = frameWidth;
            this._frameHeight = frameHeight;

            const TARGET_HEIGHT = this._settings.get_int('gnomelet-scale');
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            // displayW/H are used for physics and collision logic
            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            this._randomizeStartPos();

            // --- Image Resources ---
            this._frameImages = frameImages;

            // --- Actor Setup (St.Icon) ---
            // NOTE: St.Icon handles scaling better when using only icon_size.
            // We avoid explicit width/height to prevent conflicts with internal icon management.
            this.actor = new St.Icon({
                visible: true,
                reactive: false,
                icon_size: this._displayH,
                style: 'padding: 0px;',
            });

            // Set initial frame content
            if (this._frameImages.length > 0 && this._frameImages[0]) {
                this.actor.set_gicon(this._frameImages[0]);
            }

            // Add to the Shell's UI layer (Chrome) initially
            Main.layoutManager.addChrome(this.actor);
            this.actor.set_position(this._x, this._y);

            this._updateAnimation();
        }

        // Property to define facing based on Velocity X
        get facingRight() {
            let sign = Math.sign(this._vx);
            if (sign !== 0 && !isNaN(sign)) {
                this._savedFacing = (sign > 0);
            }
            return this._savedFacing;
        }

        /**
         * Updates the gnomelet scale when settings change.
         */
        updateScale() {
            let oldH = this._displayH;

            const TARGET_HEIGHT = this._settings.get_int('gnomelet-scale');
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            // Update the visual size of the icon
            this.actor.set_icon_size(this._displayH);

            // Adjust Y position so feet stay at the same ground level
            this._y = this._y + oldH - this._displayH;
            this.actor.set_position(this._x, this._y);
        }

        /**
         * Serializes the state for persistence
         */
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

        /**
         * Restores saved state
         */
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

            // Determine current monitor based on "feet" position
            let feetX = this._x + this._displayW / 2;
            let feetY = this._y + this._displayH;

            // Find monitors containing the X coordinate
            let monitors = Main.layoutManager.monitors.filter(m => feetX >= m.x && feetX < m.x + m.width);

            let currentMonitor = null;
            if (monitors.length === 0) {
                currentMonitor = Main.layoutManager.primaryMonitor;
            } else if (monitors.length === 1) {
                currentMonitor = monitors[0];
            } else {
                // Handle vertically stacked monitors
                monitors.sort((a, b) => a.y - b.y);
                currentMonitor = monitors.find(m => feetY < m.y + m.height);
                if (!currentMonitor) currentMonitor = monitors[monitors.length - 1];
            }

            let floorY = currentMonitor.y + currentMonitor.height;

            // --- Logic: Reposition if walking off floor ---
            let onFloorLevel = (this._y + this._displayH) >= floorY - 10;

            if (onFloorLevel) {
                // If walking outside horizontal bounds of the stage, respawn at the top
                if (this._x < -this._displayW || this._x > global.stage.width) {
                    this._respawn();
                    return;
                }
            } else {
                // Routine Wall Bounce when in air or on windows
                let maxX = global.stage.width - this._displayW;
                if (this._x < 0) {
                    this._x = 0;
                    this._vx *= -1;
                } else if (this._x > maxX) {
                    this._x = maxX;
                    this._vx *= -1;
                }
            }

            // --- Collision Detection ---
            let onGround = false;
            let landedOnWindow = null;

            if (this._vy >= 0) { // Only collide if falling downwards
                for (let win of windows) {
                    let rect = win.rect;

                    // Hitbox: Feet within window width AND close to top edge
                    let prevFeetY = prevY + this._displayH;
                    let inHorizontalRange = (feetX >= rect.x) && (feetX <= rect.x + rect.width);
                    let inVerticalRange = (feetY >= rect.y) && (prevFeetY <= rect.y + 25);

                    if (inHorizontalRange && inVerticalRange) {
                        this._y = rect.y - this._displayH + 1;
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
            if (landedOnWindow) {
                // If on a window, it must be in the same group to be ordered relative to it
                let parent = this.actor.get_parent();
                if (parent !== global.window_group) {
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    global.window_group.add_child(this.actor);
                }
                // Place it right above the window it landed on
                global.window_group.set_child_above_sibling(this.actor, landedOnWindow.actor);

            } else if (onGround && !landedOnWindow) {
                // If on the floor, follow user settings (Front/Overlay or Back/Desktop)
                let floorMode = this._settings.get_string('floor-z-order');
                let parent = this.actor.get_parent();

                if (floorMode === 'front') {
                    if (parent !== Main.layoutManager.uiGroup) {
                        if (parent) parent.remove_child(this.actor);
                        Main.layoutManager.addChrome(this.actor);
                    }
                } else {
                    // Desktop mode: behind windows but above wallpaper
                    let bgGroup = Main.layoutManager._backgroundGroup;
                    if (bgGroup && parent !== bgGroup) {
                        if (parent === Main.layoutManager.uiGroup) {
                            Main.layoutManager.removeChrome(this.actor);
                        } else if (parent) {
                            parent.remove_child(this.actor);
                        }
                        bgGroup.add_child(this.actor);
                    }
                }
            }

            // --- State Machine Transitions ---
            if (onGround) {
                if (this._state === State.FALLING || this._state === State.JUMPING) {
                    this._vy = 0;
                    this._pickNewAction();
                }
            } else {
                if (this._state !== State.JUMPING) {
                    this._state = State.FALLING;
                }
            }

            // --- AI Behavior ---
            if (this._state === State.WALKING) {
                this._idleTimer = 0;
                // Chance to stop walking
                if (Math.random() < 0.02) {
                    this._state = State.IDLE;
                    this._vx = 0;
                    this._idleTimer = Math.random() * 60 + 20;
                }
                // Small chance to jump
                if (Math.random() < 0.01) {
                    this._performJump();
                }
            } else if (this._state === State.IDLE) {
                this._vx = 0;
                this._idleTimer--;
                if (this._idleTimer <= 0) {
                    this._pickNewAction();
                }
            }

            this._updateAnimation();
            this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
        }

        /**
         * Generates a random start position above one of the monitors.
         */
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

        /**
         * Resets the character to the top.
         */
        _respawn() {
            this._randomizeStartPos();
            this._vx = 0;
            this._vy = 0;
            this._state = State.FALLING;

            let parent = this.actor.get_parent();
            if (parent !== Main.layoutManager.uiGroup) {
                if (parent) parent.remove_child(this.actor);
                Main.layoutManager.addChrome(this.actor);
            }
        }

        /**
         * Decides the next action when on the ground.
         */
        _pickNewAction() {
            let r = Math.random();
            if (r < 0.6) {
                this._state = State.WALKING;
                let dir = (Math.random() > 0.5) ? 1 : -1;
                this._vx = dir * WALK_SPEED;
            } else {
                this._state = State.IDLE;
                this._idleTimer = Math.random() * 60 + 20;
            }
        }

        /**
         * Performs a jump.
         */
        _performJump() {
            this._state = State.JUMPING;
            this._vy = JUMP_VELOCITY;
            let dir = this.facingRight ? 1 : -1;
            this._vx = dir * WALK_SPEED * 2;
        }

        /**
         * Calculates the correct frame based on state and time.
         */
        _updateAnimation() {
            this._animationTimer++;
            let frameIndex = 0;
            switch (this._state) {
                case State.WALKING:
                    let walkFrames = [0, 1, 2, 3];
                    let speed = 4; // Frame changes every 4 ticks
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

        /**
         * Applies the frame and handles horizontal flipping (mirroring).
         */
        setFrame(frameIndex) {
            if (this._frame === frameIndex && this._lastFacing === this.facingRight) return;

            this._frame = frameIndex;
            this._lastFacing = this.facingRight;

            if (this._frameImages && this._frameImages[frameIndex]) {
                this.actor.set_gicon(this._frameImages[frameIndex]);
            }

            // Horizontal mirroring
            this.actor.set_pivot_point(0.5, 0.5);
            if (this.facingRight) {
                this.actor.scale_x = 1;
            } else {
                this.actor.scale_x = -1;
            }
        }

        /**
         * Removes the actor and cleans up references.
         */
        destroy() {
            if (this.actor) {
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
 * Orchestrates the lifecycle of all characters and global resources.
 */
class GnomeletManager {
    constructor(settings) {
        this._gnomelets = [];
        this._settings = settings;
        this._windows = [];
        this._timerId = 0;
        this._cancellable = null;

        // Resource cache: { [type: string]: { frames: GIcon[], w: int, h: int } }
        this._resources = {};
        this._cacheFile = GLib.get_user_cache_dir() + '/gnomelets-state.json';

        this._loadCurrentResources();
    }

    /**
     * Loads PNG images for the selected character type.
     */
    _loadCurrentResources() {
        let type = this._settings.get_string('gnomelet-type') || 'kitten';
        if (this._resources[type]) return;

        let frames = [];
        let frameW = 0;
        let frameH = 0;
        let anySuccess = false;

        let file = Gio.File.new_for_uri(import.meta.url);
        let dir = file.get_parent();
        let typeDir = dir.get_child('images').get_child(type);

        for (let i = 0; i < 6; i++) {
            let imgFile = typeDir.get_child(`${i}.png`);
            if (!imgFile.query_exists(null)) {
                frames.push(null);
                continue;
            }

            try {
                // Read real dimensions from PNGs for physics calculation
                let pixbuf = GdkPixbuf.Pixbuf.new_from_file(imgFile.get_path());
                if (frameW === 0) {
                    frameW = pixbuf.get_width();
                    frameH = pixbuf.get_height();
                }
                let icon = new Gio.FileIcon({ file: imgFile });
                frames.push(icon);
                anySuccess = true;
            } catch (e) {
                frames.push(null);
            }
        }

        if (anySuccess && frameW > 0 && frameH > 0) {
            this._resources[type] = { frames, w: frameW, h: frameH };
        }
    }

    /**
     * Enables manager, listeners, and the main timer.
     */
    enable() {
        this._cancellable = new Gio.Cancellable();
        this._settingsSignal = this._settings.connect('changed', (settings, key) => {
            if (key === 'gnomelet-count') this._updateCount();
            else if (key === 'gnomelet-scale') this._updateScale();
            else if (key === 'gnomelet-type') {
                this._loadCurrentResources();
                this._hardReset();
            } else if (key === 'reset-trigger') this._hardReset();
        });

        // Async load: Start loading state asynchronously.
        // The gnomelets will spawn in the callback.
        this._loadStateAndSpawn();

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    /**
     * Disables everything and saves current state.
     */
    disable() {
        // Cancel any pending async load
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

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
        this._resources = {};
    }

    /**
     * Loads saved state from JSON cache file asynchronously.
     */
    _loadStateAndSpawn() {
        let file = Gio.File.new_for_path(this._cacheFile);

        file.load_contents_async(this._cancellable, (obj, res) => {
            let savedState = null;
            try {
                let [success, contents, etag] = obj.load_contents_finish(res);
                if (success) {
                    let decoder = new TextDecoder('utf-8');
                    savedState = JSON.parse(decoder.decode(contents));
                }
            } catch (e) {
                // Ignore cancellation errors or missing files
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            }

            // Proceed to spawn characters (empty state starts fresh)
            this._spawnGnomelets(savedState);
        });
    }

    /**
     * Saves the state of all characters to file.
     */
    _saveState() {
        try {
            let data = this._gnomelets.map(p => p.serialize());
            // NOTE: Using synchronous write on disable is generally accepted 
            // because we need to ensure state is saved before the extension object dies.
            // If strictly required, this could be replace_contents_async, but tricky during disable().
            GLib.file_set_contents(this._cacheFile, JSON.stringify(data));
        } catch (e) { }
    }

    _updateScale() {
        for (let p of this._gnomelets) {
            p.updateScale();
        }
    }

    _hardReset() {
        this._destroyGnomelets();
        try {
            let f = Gio.File.new_for_path(this._cacheFile);
            // This delete is synchronous but very fast and rare (user triggered).
            if (f.query_exists(null)) f.delete(null);
        } catch (e) { }
        this._spawnGnomelets(null);
    }

    /**
     * Adds or removes characters based on settings count.
     */
    _updateCount() {
        let count = this._settings.get_int('gnomelet-count');
        let current = this._gnomelets.length;
        let type = this._settings.get_string('gnomelet-type') || 'kitten';
        let res = this._resources[type];
        if (!res) return;

        if (count > current) {
            for (let i = 0; i < (count - current); i++) {
                this._gnomelets.push(new Gnomelet(res.frames, res.w, res.h, this._settings));
            }
        } else if (count < current) {
            for (let i = 0; i < (current - count); i++) {
                let p = this._gnomelets.pop();
                p.destroy();
            }
        }
    }

    _spawnGnomelets(savedState) {
        // Ensure we don't spawn if we were disabled while loading
        if (!this._cancellable || this._cancellable.is_cancelled()) return;

        let count = this._settings.get_int('gnomelet-count');
        let type = this._settings.get_string('gnomelet-type') || 'kitten';
        let res = this._resources[type];
        if (!res) return;

        // If we already have gnomelets (e.g. rapid reload), clear them first
        if (this._gnomelets.length > 0) this._destroyGnomelets();

        for (let i = 0; i < count; i++) {
            let p = new Gnomelet(res.frames, res.w, res.h, this._settings);
            if (savedState && savedState[i]) p.deserialize(savedState[i]);
            this._gnomelets.push(p);
        }
    }

    _destroyGnomelets() {
        for (let p of this._gnomelets) p.destroy();
        this._gnomelets = [];
    }

    /**
     * Tick function executed every loop to gather windows and update character states.
     */
    _tick() {
        try {
            this._windows = [];
            let focusWindow = global.display.focus_window;
            let maximizedFocused = focusWindow && isWindowMaximized(focusWindow);

            // If the focused window is maximized, we don't gather windows to let characters fall to the bottom
            if (!maximizedFocused) {
                let actors = global.window_group.get_children();
                for (let actor of actors) {
                    if (!actor.visible || !actor.meta_window) continue;
                    let rect = actor.meta_window.get_frame_rect();
                    if (actor.meta_window.minimized || isWindowMaximized(actor.meta_window)) continue;
                    this._windows.push({ rect, actor });
                }
            }
            for (let p of this._gnomelets) p.update(this._windows);
        } catch (e) { }
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