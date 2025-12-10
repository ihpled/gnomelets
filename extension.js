import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Configuration constants
const UPDATE_INTERVAL_MS = 50; // Update loop runs every 50ms (~20 FPS)
const GRAVITY = 2;             // Vertical acceleration per frame
const WALK_SPEED = 3;          // Horizontal pixels per frame
const JUMP_VELOCITY = -20;     // Initial jump force (negative is up)

// State Machine Definitions for the Pet
const State = {
    FALLING: 'FALLING',
    WALKING: 'WALKING',
    IDLE: 'IDLE',
    JUMPING: 'JUMPING'
};

/**
 * Pet Class
 * Represents a single animated kitten on the screen.
 * Handles rendering, physics, AI, and window interactions.
 */
const Pet = GObject.registerClass(
    class Pet extends GObject.Object {
        _init(imagePath, sheetWidth, sheetHeight, settings) {
            super._init();

            this._settings = settings;
            console.log(`[Desktop Pets] Pet init: sheet=${sheetWidth}x${sheetHeight}`);

            // --- Initialization ---
            // Start falling from the top of the screen at a random X position
            this._state = State.FALLING;
            this._x = Math.floor(Math.random() * (global.stage.width - 100)); // Ensure it starts within bounds
            this._y = 0;
            this._vx = 0; // Velocity X
            this._vy = 0; // Velocity Y

            // --- Animation State ---
            this._frame = 0;           // Current sprite frame index
            this._animationTimer = 0;  // Counter for animation timing
            this._savedFacing = Math.random() > 0.5; // Initial Direction (replaces _facingRight)
            this._idleTimer = 0;       // Countdown for how long to sit idle

            this._imagePath = imagePath;

            // --- Configurable Dimensions ---
            // We calculate the optimal display size based on the source image size
            // ensuring high quality and correct aspect ratio for a ~64px height.
            this._sheetWidth = sheetWidth;
            this._sheetHeight = sheetHeight;
            this._frameWidth = sheetWidth / 6; // Assuming 6 frames horizontally
            this._frameHeight = sheetHeight;

            const TARGET_HEIGHT = 64;
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            // --- Actor Hierarchy (Rendering) ---
            // We use a "Hardware Scissor" technique for rendering sprites.
            // 1. Container (this.actor): A generic Widget sized to a SINGLE frame. 
            //    It clips its children (`clip_to_allocation: true`), acting as a viewport.
            this.actor = new St.Widget({
                visible: true,
                reactive: false,     // Click-through
                x_expand: false,
                y_expand: false,
                width: this._displayW,
                height: this._displayH,
                clip_to_allocation: true
            });

            // 2. Sprite Actor (this._spriteActor): Holds the entire sprite sheet image.
            //    It is much wider than the container. We animate by moving this actor
            //    left/right inside the container to reveal different frames.
            this._spriteW = this._displayW * 6;
            this._spriteH = this._displayH;

            this._spriteActor = new St.Widget({
                width: this._spriteW,
                height: this._spriteH
            });

            // Apply the sprite sheet image via CSS
            let fileUrl = `file://${this._imagePath}`;
            this._spriteActor.set_style(`
                background-image: url("${fileUrl}");
                background-size: ${this._spriteW}px ${this._spriteH}px;
                background-repeat: no-repeat;
            `);

            this.actor.add_child(this._spriteActor);

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

        /**
         * Main update loop for the pet.
         * Called by PetManager every tick.
         * @param {Array} windows - List of visible windows to interact with.
         */
        update(windows) {
            if (!this.actor) return; // Guard against updates after destruction

            // --- Physics Engine ---
            // Apply Gravity
            if (this._state === State.FALLING || this._state === State.JUMPING) {
                this._vy += GRAVITY;
            }

            // Stop movement if idle (prevents sliding)
            if (this._state === State.IDLE) {
                this._vx = 0;
            }

            // Update Position
            this._x += this._vx;
            this._y += this._vy;

            // --- Logic: Reposition on Floor Exit ---
            // If the pet is on the "floor" and walks off-screen, respawn it at the top.
            let onFloorLevel = (this._y + this._displayH) >= global.stage.height - 10;

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
                let feetX = this._x + this._displayW / 2;
                let feetY = this._y + this._displayH;

                // Check against all windows
                for (let win of windows) {
                    let rect = win.rect;

                    // Hitbox: Feet within window width AND close to top edge
                    let inHorizontalRange = (feetX >= rect.x) && (feetX <= rect.x + rect.width);
                    let inVerticalRange = (feetY >= rect.y) && (feetY <= rect.y + 25);

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
                    if (feetY >= global.stage.height) {
                        this._y = global.stage.height - this._displayH;
                        this._vy = 0;
                        onGround = true;
                    }
                }
            }

            // --- Z-Ordering / Layering Logic ---
            // This is complex because we want pets to stand ON windows (appear in front of them),
            // but arguably BEHIND windows that are covering the one they stand on.

            if (landedOnWindow) {
                // 1. Landing on a Window:
                // Move the pet actor into the global 'window_group'.
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

                // Check if we walked off a ledge (Support check)
                if (this._state === State.WALKING || this._state === State.IDLE) {
                    let midX = this._x + this._displayW / 2;
                    let bottomY = this._y + this._displayH;
                    let support = false;

                    // Check if supported by floor
                    if (Math.abs(bottomY - global.stage.height) < 5) {
                        support = true;
                    } else {
                        // Check if supported by any window
                        for (let win of windows) {
                            let rect = win.rect;
                            let inH = (midX >= rect.x) && (midX <= rect.x + rect.width);
                            let inV = Math.abs(bottomY - rect.y) < 10;
                            if (inH && inV) {
                                support = true;
                                break;
                            }
                        }
                    }

                    if (!support) {
                        this._state = State.FALLING;
                    }
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

        _respawn() {
            // Reset to top to fall again
            this._y = 0;
            this._x = Math.floor(Math.random() * (global.stage.width - this._displayW));
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
            // "Scroll" the sprite sheet inside the container
            let moveX = -(frameIndex * this._displayW);
            this._spriteActor.set_position(Math.floor(moveX), 0);

            // Handle facing direction via scaling (flipping)
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
        }
    });

/**
 * PetManager Class
 * Orchestrates the lifecycle of all pets.
 */
class PetManager {
    constructor(settings) {
        this._pets = [];
        this._settings = settings;
        this._windows = [];
        this._timerId = 0;
        this._imagePath = null;
        this._imgW = 0;
        this._imgH = 0;

        // Resolve image path
        let file = Gio.File.new_for_uri(import.meta.url);
        let dir = file.get_parent();
        let imageFile = dir.get_child('images').get_child('kitten.png');
        this._imagePath = imageFile.get_path();

        // Pre-load image dimensions info using GdkPixbuf
        // This allows us to support arbitrary high-res sprites
        try {
            let pb = GdkPixbuf.Pixbuf.new_from_file(this._imagePath);
            this._imgW = pb.get_width();
            this._imgH = pb.get_height();
            console.log(`[Desktop Pets] Loaded image: ${this._imgW}x${this._imgH}`);
        } catch (e) {
            console.error(`[Desktop Pets] Failed to load image info: ${e.message}`);
        }
    }

    enable() {
        if (!this._imagePath || this._imgW === 0) return;

        // Spawn pets based on user setting
        let count = this._settings.get_int('pet-count');
        console.log(`[Desktop Pets] Enabling... Spawning ${count} pets.`);

        for (let i = 0; i < count; i++) {
            let p = new Pet(this._imagePath, this._imgW, this._imgH, this._settings);
            this._pets.push(p);
        }

        // Start the Main Loop
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }

        for (let p of this._pets) {
            p.destroy();
        }
        this._pets = [];
    }

    _tick() {
        // Wrap tick in try-catch to prevent extension crash from transient errors
        try {
            this._windows = [];

            // Gather all visible windows from the shell
            // We use global.window_group to get the actual Actor hierarchy
            let actors = global.window_group.get_children();
            for (let actor of actors) {
                if (!actor.visible) continue;

                // Only care about actors that have a MetaWindow (real application windows)
                if (actor.meta_window) {
                    let rect = actor.meta_window.get_frame_rect();
                    if (actor.meta_window.minimized) continue;

                    this._windows.push({
                        rect: rect,
                        actor: actor
                    });
                }
            }

            // Update individual pets
            for (let p of this._pets) {
                p.update(this._windows);
            }
        } catch (e) {
            console.error(`[Desktop Pets] Error: ${e.message}`);
        }
    }
}

/**
 * Extension Entry Point
 */
export default class DesktopPetsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._manager = new PetManager(this._settings);
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
