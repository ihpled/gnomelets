import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {
    State,
    GRAVITY,
    WALK_SPEED,
    JUMP_VELOCITY,
    JUMP_REACH_X,
    MAX_JUMP_HEIGHT,
    isWindowMaximized
} from './utils.js';

/**
 * Gnomelet Class
 * Represents a single animated character on the screen.
 * Uses pre-sliced images loaded by the Manager.
 */
export const Gnomelet = GObject.registerClass(
    class Gnomelet extends GObject.Object {
        _init(typeName, frameImages, frameWidth, frameHeight, settings, resourceProvider) {
            super._init();

            this._typeName = typeName;
            this._settings = settings;
            this._resourceProvider = resourceProvider;

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

            this.actor._delegate = this; // Fix for DND source identification

            // Set initial layer based on context (Fix for maximized window visibility)
            this._resetLayer();
            this.actor.set_position(this._x, this._y);

            this._updateInteraction();
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

        // Mock 'app' property to prevent crashes with gtk4-ding
        get app() {
            return null;
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
         * Updates the interaction mode (dragging) based on settings.
         */
        _updateInteraction() {
            let allowInteraction = this._settings.get_boolean('allow-interaction');

            // If allowed and not yet draggable, make it draggable
            if (allowInteraction) {
                if (!this._draggable) {
                    this.actor.reactive = true;
                    this._draggable = DND.makeDraggable(this.actor);
                    this._dragBeginId = this._draggable.connect('drag-begin', this._onDragBegin.bind(this));
                    this._dragEndId = this._draggable.connect('drag-end', this._onDragEnd.bind(this));
                    this._dragCancelledId = this._draggable.connect('drag-cancelled', () => console.log('[gnomelets] Drag cancelled'));
                }
            } else {
                // To disable, we make the actor non-reactive.
                // We don't remove the draggable instance as it's bound to the actor,
                // but reactivity controls the mouse events.
                this.actor.reactive = false;
            }
        }

        _onDragBegin() {
            this._state = State.DRAGGING;
            this._vx = 0;
            this._vy = 0;
            this._updateAnimation();

            // Create a full-screen transparent overlay to capture the drop event
            // This prevents the shell crash caused by unhiding the source actor from pick
            this._dragOverlay = new Clutter.Actor({
                width: global.stage.width,
                height: global.stage.height,
                reactive: true
            });
            this._dragOverlay._delegate = this; // Route drag events to this Gnomelet instance
            Main.layoutManager.uiGroup.add_child(this._dragOverlay);
        }

        handleDragOver(source, actor, x, y, time) {
            // We accept drag over from ourselves (or potentially others if we wanted)
            return DND.DragMotionResult.MOVE_DROP;
        }

        acceptDrop(source, actor, x, y, time) {
            // Update internal coordinates
            this._x = actor.x;
            this._y = actor.y;

            // CRITICAL: Reparent to window_group to save it from dnd.js auto-destruction.
            // dnd.js attempts to destroy the drag actor if it is found in Main.uiGroup after a successful drop.
            // We temporarily move it to window_group to bypass that check.
            let parent = this.actor.get_parent();
            if (parent === Main.layoutManager.uiGroup) {
                Main.layoutManager.removeChrome(this.actor);
            } else if (parent) {
                parent.remove_child(this.actor);
            }
            global.window_group.add_child(this.actor);

            this.actor.set_position(this._x, this._y);

            return true;
        }

        _onDragEnd() {
            if (this._dragOverlay) {
                this._dragOverlay.destroy();
                this._dragOverlay = null;
            }

            // Update internal coordinates to match where the actor ended up
            this._x = this.actor.x;
            this._y = this.actor.y;

            // Reset visual transforms that might be corrupted by external DND logic
            this.actor.rotation_angle_z = 0;
            this.actor.scale_y = 1;
            this.actor.opacity = 255;

            // Re-apply correct facing (scale_x)
            this.actor.set_pivot_point(0.5, 0.5);
            this.actor.scale_x = this.facingRight ? 1 : -1;

            this._state = State.FALLING;
            this._vx = 0;
            this._vy = 0;

            // Now that the drag flow is complete and dnd.js is satisfied, 
            // put the actor back in the correct layer (which might be uiGroup).
            this._resetLayer();
        }

        /**
         * Serializes the state for persistence
         */
        serialize() {
            return {
                type: this._typeName,
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


            // Handle type change if the saved state has a different gnomelet type
            if (data.type && data.type !== this._typeName && this._resourceProvider) {
                let res = this._resourceProvider(data.type);
                if (res) {
                    this._typeName = res.type;
                    this._frameImages = res.frames;
                    this._frameWidth = res.w;
                    this._frameHeight = res.h;
                    this.updateScale();
                }
            }

            if (data.x !== undefined) this._x = data.x;
            if (data.y !== undefined) this._y = data.y;
            if (data.vx !== undefined) this._vx = data.vx;
            if (data.vy !== undefined) this._vy = data.vy;
            if (data.state !== undefined) this._state = data.state;
            if (data.facing !== undefined) this._savedFacing = data.facing;
            if (data.idleTimer !== undefined) this._idleTimer = data.idleTimer;

            this.actor.set_position(this._x, this._y);
            this.setFrame(this._frame); // Refresh frame in case type changed
        }

        /**
         * Main update loop for the gnomelet.
         */
        update(windows, forceBackground) {
            if (!this.actor) return; // Guard against updates after destruction
            if (this._state === State.DRAGGING) return; // Suspended physics while dragging

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

            } else {
                // If on the floor, apply calculated Z-order preference (passed from Manager)
                let parent = this.actor.get_parent();

                if (!forceBackground) {
                    if (parent !== Main.layoutManager.uiGroup) {
                        if (parent) parent.remove_child(this.actor);
                        Main.layoutManager.addChrome(this.actor);
                    }
                } else {
                    // Background Group
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
                // On ground
                if (this._state === State.FALLING || this._state === State.JUMPING) {
                    this._vy = 0;
                    this._pickNewAction();
                }
            } else {
                // Not on ground
                if (this._state !== State.JUMPING) {
                    // Logic: If we were walking and now we are not on ground, we are walking off an edge.
                    let jumped = false;
                    if (this._state === State.WALKING) {
                        // "Jump for falling": Chance to jump when reaching the edge
                        if (Math.random() < 0.5) {
                            this._performJump();
                            jumped = true;
                        }
                    }

                    if (!jumped) {
                        this._state = State.FALLING;
                    }
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

                // Logic: "Jump only when useful" - Check for window overhead
                let canJump = false;

                // Let's recalculate precise feet position after collision adjustments
                let currFeetY = this._y + this._displayH;
                let currFeetX = this._x + this._displayW / 2;

                for (let win of windows) {
                    // Skip the window we are currently standing on
                    if (landedOnWindow && win === landedOnWindow) continue;

                    let rect = win.rect;

                    let effectiveMinX = rect.x;
                    let effectiveMaxX = rect.x + rect.width;

                    // Check if window is horizontally within range of our feet
                    // We extend the "virtual" window size if we are approaching it from the side
                    if (currFeetX < rect.x && this.facingRight) {
                        effectiveMinX -= JUMP_REACH_X;
                    } else if (currFeetX > rect.x + rect.width && !this.facingRight) {
                        effectiveMaxX += JUMP_REACH_X;
                    }

                    if (currFeetX >= effectiveMinX && currFeetX <= effectiveMaxX) {
                        // Check if window is vertically above us and reachable
                        // Window top (rect.y) must be less than feet (currFeetY)
                        let dist = currFeetY - rect.y;
                        if (dist > 0 && dist <= MAX_JUMP_HEIGHT) {
                            canJump = true;
                            break;
                        }
                    }
                }

                // If useful, chance to jump
                if (canJump) {
                    if (Math.random() < 0.25) {
                        this._performJump();
                    }
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
         * Determines if the gnomelet should be in the background layer.
         */
        _isBackgroundMode() {
            let floorMode = this._settings.get_string('floor-z-order');
            if (floorMode === 'allow') return false;

            let focusWindow = global.display.focus_window;
            let focusedIsMaximized = focusWindow && isWindowMaximized(focusWindow);

            if (floorMode === 'partial') {
                return focusedIsMaximized;
            }

            // Disallow logic: Background if ANY visible window is maximized
            if (focusedIsMaximized) return true;

            let actors = global.window_group.get_children();
            for (let actor of actors) {
                if (actor.visible && actor.meta_window && !actor.meta_window.minimized &&
                    actor.meta_window.get_window_type() === Meta.WindowType.NORMAL &&
                    isWindowMaximized(actor.meta_window)) {
                    return true;
                }
            }
            return false;
        }

        /**
         * Sets the initial layer for the actor based on the floor z-order setting.
         */
        _resetLayer() {
            let spawnInBackground = this._isBackgroundMode();
            let parent = this.actor.get_parent();

            if (spawnInBackground) {
                let bgGroup = Main.layoutManager._backgroundGroup;
                if (bgGroup && parent !== bgGroup) {
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    bgGroup.add_child(this.actor);
                }
            } else {
                if (parent !== Main.layoutManager.uiGroup) {
                    if (parent) parent.remove_child(this.actor);
                    Main.layoutManager.addChrome(this.actor);
                }
            }
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
            // Pick new type/identity on respawn
            if (this._resourceProvider) {
                let res = this._resourceProvider(); // Pick random
                if (res) {
                    this._typeName = res.type;
                    this._frameImages = res.frames;
                    this._frameWidth = res.w;
                    this._frameHeight = res.h;
                    this.updateScale();
                }
            }

            this._randomizeStartPos();
            this._vx = 0;
            this._vy = 0;
            this._state = State.FALLING;

            this._resetLayer();
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
                case State.DRAGGING:
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
            if (this._draggable) {
                if (this._dragBeginId) this._draggable.disconnect(this._dragBeginId);
                if (this._dragEndId) this._draggable.disconnect(this._dragEndId);
                if (this._dragCancelledId) this._draggable.disconnect(this._dragCancelledId);
                this._draggable = null;
            }

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
