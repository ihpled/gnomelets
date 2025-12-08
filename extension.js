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

const UPDATE_INTERVAL_MS = 50; // 20 FPS
const GRAVITY = 2;
const WALK_SPEED = 3;
const JUMP_VELOCITY = -20;

// States
const State = {
    FALLING: 'FALLING',
    WALKING: 'WALKING',
    IDLE: 'IDLE',
    JUMPING: 'JUMPING'
};

const Pet = GObject.registerClass(
    class Pet extends GObject.Object {
        _init(imagePath, sheetWidth, sheetHeight, settings) {
            super._init();

            this._settings = settings;
            console.log(`[Desktop Pets] Pet init: sheet=${sheetWidth}x${sheetHeight}`);

            // Start random X, Y=0 (top)
            this._state = State.FALLING;
            this._x = Math.floor(Math.random() * (global.stage.width - 100));
            this._y = 0;
            this._vx = 0;
            this._vy = 0;

            // Animation
            this._frame = 0;
            this._animationTimer = 0;
            this._facingRight = Math.random() > 0.5;
            this._idleTimer = 0;

            this._imagePath = imagePath;

            // Dimensions
            this._sheetWidth = sheetWidth;
            this._sheetHeight = sheetHeight;
            this._frameWidth = sheetWidth / 6;
            this._frameHeight = sheetHeight;

            const TARGET_HEIGHT = 64;
            const scaleFactor = TARGET_HEIGHT / this._frameHeight;

            this._displayW = Math.floor(this._frameWidth * scaleFactor);
            this._displayH = Math.floor(TARGET_HEIGHT);

            // Actor Hierarchy
            this.actor = new St.Widget({
                visible: true,
                reactive: false,
                x_expand: false,
                y_expand: false,
                width: this._displayW,
                height: this._displayH,
                clip_to_allocation: true
            });

            this._spriteW = this._displayW * 6;
            this._spriteH = this._displayH;

            this._spriteActor = new St.Widget({
                width: this._spriteW,
                height: this._spriteH
            });

            let fileUrl = `file://${this._imagePath}`;
            this._spriteActor.set_style(`
             background-image: url("${fileUrl}");
             background-size: ${this._spriteW}px ${this._spriteH}px;
             background-repeat: no-repeat;
        `);

            this.actor.add_child(this._spriteActor);

            // Start in Chrome
            Main.layoutManager.addChrome(this.actor);
            this.actor.set_position(this._x, this._y);

            this._updateAnimation();
        }

        update(windows) {
            if (!this.actor) return; // Destroyed

            // Apply Physics
            if (this._state === State.FALLING || this._state === State.JUMPING) {
                this._vy += GRAVITY;
            }

            if (this._state === State.IDLE) {
                this._vx = 0;
            }

            this._x += this._vx;
            this._y += this._vy;

            // -- FEATURE: Recycle on Floor Exit --
            // If we are on the floor (approximately) and go off-screen, reset.
            // We consider "floor" area anything near/below screen height.
            let onFloorLevel = (this._y + this._displayH) >= global.stage.height - 10;

            if (onFloorLevel) {
                // Check boundaries: if completely out left OR right
                if (this._x < -this._displayW || this._x > global.stage.width) {
                    this._respawn();
                    return;
                }
            } else {
                // Normal Wall Bounce on windows/air
                let maxX = global.stage.width - this._displayW;
                if (this._x < 0) {
                    this._x = 0;
                    this._vx *= -1;
                    this._facingRight = !this._facingRight;
                } else if (this._x > maxX) {
                    this._x = maxX;
                    this._vx *= -1;
                    this._facingRight = !this._facingRight;
                }
            }


            // Collision Detection
            let onGround = false;
            let landedOnWindow = null;

            if (this._vy >= 0) { // Moving down
                let feetX = this._x + this._displayW / 2;
                let feetY = this._y + this._displayH;

                for (let win of windows) {
                    let rect = win.rect;

                    let inHorizontalRange = (feetX >= rect.x) && (feetX <= rect.x + rect.width);
                    let inVerticalRange = (feetY >= rect.y) && (feetY <= rect.y + 25);

                    if (inHorizontalRange && inVerticalRange) {
                        this._y = rect.y - this._displayH + 1;
                        this._vy = 0;
                        onGround = true;
                        landedOnWindow = win;
                        break;
                    }
                }

                if (!landedOnWindow) {
                    if (feetY >= global.stage.height) {
                        this._y = global.stage.height - this._displayH;
                        this._vy = 0;
                        onGround = true;
                    }
                }
            }

            // Z-Ordering logic
            if (landedOnWindow) {
                let parent = this.actor.get_parent();
                if (parent !== global.window_group) {
                    if (parent === Main.layoutManager.uiGroup) {
                        Main.layoutManager.removeChrome(this.actor);
                    } else if (parent) {
                        parent.remove_child(this.actor);
                    }
                    global.window_group.add_child(this.actor);
                }
                global.window_group.set_child_above_sibling(this.actor, landedOnWindow.actor);

            } else if (onGround && !landedOnWindow) {
                // -- FEATURE: Configurable Floor Z-Order --
                let floorMode = this._settings.get_string('floor-z-order'); // 'front' or 'back'

                let parent = this.actor.get_parent();

                if (floorMode === 'front') {
                    if (parent !== Main.layoutManager.uiGroup) {
                        if (parent) parent.remove_child(this.actor);
                        Main.layoutManager.addChrome(this.actor);
                    }
                } else {
                    // Back mode: Put in window_group but at the very bottom
                    if (parent !== global.window_group) {
                        if (parent === Main.layoutManager.uiGroup) {
                            Main.layoutManager.removeChrome(this.actor);
                        } else if (parent) {
                            parent.remove_child(this.actor);
                        }
                        global.window_group.add_child(this.actor);
                    }
                    // Send to back of window group
                    global.window_group.set_child_at_index(this.actor, 0);
                }
            }

            // State Transitions
            if (onGround) {
                if (this._state === State.FALLING || this._state === State.JUMPING) {
                    this._state = State.WALKING;
                    this._vy = 0;
                    this._pickNewAction();
                }

                if (this._state === State.WALKING || this._state === State.IDLE) {
                    let midX = this._x + this._displayW / 2;
                    let bottomY = this._y + this._displayH;
                    let support = false;

                    if (Math.abs(bottomY - global.stage.height) < 5) {
                        support = true;
                    } else {
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
                if (this._state !== State.JUMPING) {
                    this._state = State.FALLING;
                }
            }

            // AI & Movement
            if (this._state === State.WALKING) {
                this._vx = this._facingRight ? WALK_SPEED : -WALK_SPEED;
                this._idleTimer = 0;

                if (Math.random() < 0.02) {
                    this._state = State.IDLE;
                    this._vx = 0;
                    this._idleTimer = Math.random() * 60 + 20;
                }
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

        _respawn() {
            // Reset to top, random X
            this._y = 0;
            this._x = Math.floor(Math.random() * (global.stage.width - this._displayW));
            this._vx = 0;
            this._vy = 0;
            this._state = State.FALLING;

            // Ensure parent is reset to Chrome for falling visibility
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
                this._facingRight = Math.random() > 0.5;
            } else {
                this._state = State.IDLE;
                this._idleTimer = Math.random() * 60 + 20;
            }
        }

        _performJump() {
            this._state = State.JUMPING;
            this._vy = JUMP_VELOCITY;
            this._vx = this._facingRight ? WALK_SPEED * 2 : -WALK_SPEED * 2;
        }

        _updateAnimation() {
            this._animationTimer++;
            let frameIndex = 0;
            if (this._state === State.WALKING) {
                let walkFrames = [0, 1, 2, 3];
                let speed = 4;
                let idx = Math.floor(this._animationTimer / speed) % walkFrames.length;
                frameIndex = walkFrames[idx];
            } else if (this._state === State.IDLE) {
                frameIndex = 4;
            } else if (this._state === State.JUMPING || this._state === State.FALLING) {
                frameIndex = 5;
            }
            this.setFrame(frameIndex);
        }

        setFrame(frameIndex) {
            let moveX = -(frameIndex * this._displayW);
            this._spriteActor.set_position(Math.floor(moveX), 0);

            this.actor.set_pivot_point(0.5, 0.5);
            if (this._facingRight) {
                this.actor.scale_x = 1;
            } else {
                this.actor.scale_x = -1;
            }
        }

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
        }
    });

class PetManager {
    constructor(settings) {
        this._pets = [];
        this._settings = settings;
        this._windows = [];
        this._timerId = 0;
        this._imagePath = null;
        this._imgW = 0;
        this._imgH = 0;

        let file = Gio.File.new_for_uri(import.meta.url);
        let dir = file.get_parent();
        let imageFile = dir.get_child('images').get_child('kitten.png');
        this._imagePath = imageFile.get_path();

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

        let count = this._settings.get_int('pet-count');
        console.log(`[Desktop Pets] Enabling... Spawning ${count} pets.`);

        for (let i = 0; i < count; i++) {
            let p = new Pet(this._imagePath, this._imgW, this._imgH, this._settings);
            this._pets.push(p);
        }

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
        try {
            this._windows = [];
            let actors = global.window_group.get_children();
            for (let actor of actors) {
                if (!actor.visible) continue;

                if (actor.meta_window) {
                    let rect = actor.meta_window.get_frame_rect();
                    if (actor.meta_window.minimized) continue;

                    this._windows.push({
                        rect: rect,
                        actor: actor
                    });
                }
            }

            for (let p of this._pets) {
                p.update(this._windows);
            }
        } catch (e) {
            console.error(`[Desktop Pets] Error: ${e.message}`);
        }
    }
}

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
