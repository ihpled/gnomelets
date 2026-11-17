import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Gnomelet } from './gnomelet.js';
import { State, UPDATE_INTERVAL_MS } from './utils.js';
import { SpeechBubble, InputBubble, ResponseBubble } from './claude-ui.js';
import { sanitizeText } from './claude-state-watcher.js';

// --- Tunables -------------------------------------------------------------
const DRAG_THRESHOLD_PX = 8;
const DOUBLE_CLICK_MS = 350;
const SLEEP_TICKS = Math.round(60000 / UPDATE_INTERVAL_MS); // ~60s without interaction
const THINK_TO_TYPE_TICKS = Math.round(3000 / UPDATE_INTERVAL_MS); // ~3s
const REVERT_TICKS = Math.round(4000 / UPDATE_INTERVAL_MS); // ~4s
const CLAUDE_TIMEOUT_MS = 120000;
const MAX_PROMPT_CHARS = 4000;
const MAX_STDOUT_CHARS = 8000;
const MAX_STDERR_CHARS = 600;
const MOOD_PERSIST = -1;

const QUIPS = [
    'It works on my machine.',
    'Have you tried turning it off and on again?',
    'git push --force? Bold.',
    'There are only two hard things: cache invalidation and naming.',
    'I would refactor that, but the tests are afraid.',
    'TODO: fix later. (Narrator: they did not.)',
    'Compiling... please hold my tokens.',
    'That is not a bug, it is an undocumented feature.',
    'Context window: 87% vibes.',
    'Reading the docs? In this economy?',
    'Let me just add one more abstraction...',
    'sudo make me a sandwich.',
    'Merge conflicts build character.',
    'I hallucinate less when you say please.',
    'Ship it! (after lunch)',
    '404: motivation not found.',
];

const SESSION_DEFAULT_TEXT = {
    thinking: 'Thinking...',
    typing: 'Typing...',
    done: 'Done!',
    error: 'Something went wrong.',
};

const SPARKLE_COLORS = ['#ffd54a', '#d97757', '#f5e0dc', '#8bd5ca'];

// --- Claude CLI runner ----------------------------------------------------

/**
 * Resolves the claude binary. GNOME Shell's PATH often lacks user bin dirs,
 * so common install locations are tried as fallbacks.
 */
function resolveClaudeBinary() {
    const found = GLib.find_program_in_path('claude');
    if (found) return found;

    const home = GLib.get_home_dir();
    const candidates = [
        `${home}/.local/bin/claude`,
        `${home}/.claude/local/claude`,
        '/usr/local/bin/claude',
        `${home}/.npm-global/bin/claude`,
        '/usr/bin/claude',
    ];
    for (const path of candidates) {
        if (GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE) &&
            !GLib.file_test(path, GLib.FileTest.IS_DIR))
            return path;
    }
    return null;
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Strips control characters except newline/tab; display is plain text only. */
function cleanOutput(text) {
    return String(text).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

/**
 * Runs `claude -p <prompt>` headless, fully asynchronously. One request at a
 * time. Hard timeout via one tracked timeout that force-exits the process.
 */
export class ClaudeRunner {
    constructor() {
        this._destroyed = false;
        this._busy = false;
        this._proc = null;
        this._cancellable = null;
        this._timeoutId = 0;
        this._timedOut = false;
    }

    get busy() {
        return this._busy;
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    /**
     * onDone receives {kind: 'ok'|'failed'|'timeout'|'missing'|'error', ...}.
     * Returns false if a request is already running (or runner destroyed).
     */
    run(prompt, onDone) {
        if (this._destroyed || this._busy) return false;

        const binary = resolveClaudeBinary();
        if (!binary) {
            onDone({ kind: 'missing' });
            return true;
        }

        // A prompt starting with '-' must never be parsed as a CLI flag.
        let safePrompt = String(prompt).slice(0, MAX_PROMPT_CHARS);
        if (safePrompt.startsWith('-')) safePrompt = ` ${safePrompt}`;

        let proc;
        try {
            // No shell: argv is passed directly. Permission model is the CLI's own.
            const launcher = new Gio.SubprocessLauncher({
                // STDIN_PIPE + communicate(null) closes stdin at once, so the CLI never
                // waits on (or reads from) the shell's inherited stdin.
                flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.set_cwd(GLib.get_home_dir());
            proc = launcher.spawnv([binary, '-p', safePrompt]);
        } catch (e) {
            onDone({ kind: 'error', message: String(e.message || e) });
            return true;
        }

        this._busy = true;
        this._proc = proc;
        this._timedOut = false;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLAUDE_TIMEOUT_MS, () => {
            this._timeoutId = 0;
            this._timedOut = true;
            try {
                if (this._proc) this._proc.force_exit();
            } catch (e) {
                // Already exited
            }
            // Report right away: grandchildren may keep the pipes open, so
            // communicate() is not guaranteed to complete after force_exit().
            cancellable.cancel();
            this._proc = null;
            this._cancellable = null;
            this._busy = false;
            if (!this._destroyed) onDone({ kind: 'timeout' });
            return GLib.SOURCE_REMOVE;
        });

        proc.communicate_utf8_async(null, cancellable, (p, res) => {
            if (this._destroyed || cancellable.is_cancelled() || this._cancellable !== cancellable)
                return;

            this._clearTimeout();
            let result;
            try {
                const [, stdout, stderr] = p.communicate_utf8_finish(res);
                const exited = p.get_if_exited();
                const status = exited ? p.get_exit_status() : -1;
                result = {
                    kind: this._timedOut ? 'timeout' : (p.get_successful() ? 'ok' : 'failed'),
                    stdout: stdout || '',
                    stderr: stderr || '',
                    status,
                };
            } catch (e) {
                result = { kind: this._timedOut ? 'timeout' : 'error', message: String(e.message || e) };
            }

            this._proc = null;
            this._cancellable = null;
            this._busy = false;
            onDone(result);
        });
        return true;
    }

    /**
     * Cancels any running request and kills the process. Idempotent.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._clearTimeout();
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._proc) {
            try {
                this._proc.force_exit();
            } catch (e) {
                // Already exited
            }
            this._proc = null;
        }
        this._busy = false;
    }
}

// --- The pet --------------------------------------------------------------

/**
 * ClaudePet: an interactive pet with its own pointer handling, bubbles,
 * context menu, optional Claude CLI chat and external session-state reactions.
 *
 * Mood (overlay on top of the physics state of the base class) is one of:
 * null, THINKING, TYPING, HAPPY, SLEEPING, ERROR.
 */
export const ClaudePet = GObject.registerClass(
    class ClaudePet extends Gnomelet {
        /**
         * callbacks: { spawnPet(): void, dismissPet(pet): void }
         */
        _init(frameImages, frameWidth, frameHeight, settings, callbacks) {
            // Fields used by hooks that the base _init triggers.
            this._claudeReady = false;
            this._destroyed = false;
            super._init('Claude', frameImages, frameWidth, frameHeight, settings, null);

            this._callbacks = callbacks || {};

            this._mood = null;
            this._moodTicks = 0;
            this._sitting = false;
            this._idleTicks = 0;
            this._thinkTicks = 0;
            this._requestActive = false;
            this._sessionMessage = null;
            this._lastWindows = [];

            // Pointer state
            this._pressing = false;
            this._dragging = false;
            this._press = null;
            this._lastClickX = 0;
            this._lastClickY = 0;
            this._clickTimeoutId = 0;

            // Owned resources
            this._speech = new SpeechBubble();
            this._response = new ResponseBubble();
            this._input = null;
            this._menu = null;
            this._menuManager = null;
            this._focusItem = null;
            this._sparkles = new Set();
            this._idleSources = new Set();
            this._runner = new ClaudeRunner();

            this._claudeReady = true;
        }

        // --- Base-class hooks -------------------------------------------------

        /**
         * Always reactive, independent of the `allow-interaction` setting.
         * Called by the base _init and by the manager for plain gnomelets only.
         */
        _updateInteraction() {
            this.actor.reactive = true;
            if (this._pointerConnected) return;
            this._pointerConnected = true;
            this.actor.connectObject(
                'button-press-event', (actor, event) => this._onButtonPress(event),
                this);
        }

        _isFocusMode() {
            return this._settings.get_boolean('focus-mode');
        }

        _pickNewAction() {
            if (this._mood !== null || this._isFocusMode()) {
                // Stay put: no walking in focus mode or while the mood is active.
                this._state = State.IDLE;
                this._vx = 0;
                this._idleTimer = Math.random() * 40 + 40;
                this._sitting = true;
                return;
            }
            super._pickNewAction();
            this._sitting = (this._state === State.IDLE) && Math.random() < 0.4;
        }

        _onTickBefore(windows) {
            if (!this._claudeReady || this._destroyed) return;
            this._lastWindows = windows || [];

            // Mood countdown
            if (this._moodTicks > 0) {
                this._moodTicks--;
                if (this._moodTicks === 0) this._mood = null;
            }
            if (this._requestActive && this._mood === State.THINKING) {
                this._thinkTicks++;
                if (this._thinkTicks >= THINK_TO_TYPE_TICKS) this._mood = State.TYPING;
            }

            // Sleep after ~60s without interaction (counted by this very tick)
            this._idleTicks++;
            if (this._mood === null && this._state === State.IDLE &&
                this._idleTicks >= SLEEP_TICKS && !this._pressing &&
                !this._requestActive && !(this._input && this._input.isOpen) &&
                !(this._menu && this._menu.isOpen)) {
                this._mood = State.SLEEPING;
                this._moodTicks = MOOD_PERSIST;
            }

            // Hold still while a mood is active, in focus mode, or while the menu is open
            if (this._state === State.WALKING &&
                (this._mood !== null || this._isFocusMode() || (this._menu && this._menu.isOpen))) {
                this._state = State.IDLE;
                this._vx = 0;
                this._idleTimer = 40;
                this._sitting = true;
            }
        }

        _onTickAfter() {
            if (!this._claudeReady || this._destroyed || !this.actor) return;

            const rect = this._anchorRect();
            // In the background layer the pet is hidden behind windows: do not
            // leave its speech bubble floating on top of them.
            if (this.actor.get_parent() === Main.layoutManager._backgroundGroup)
                this._speech.hideNow();
            this._speech.reposition(rect);
            this._response.reposition(rect);
            if (this._input) this._input.reposition(rect);

            // Error pose shakes a little
            if (this._mood === State.ERROR)
                this._icon.translation_x = (this._animationTimer % 2 === 0) ? 2 : -2;
            else if (this._icon.translation_x !== 0)
                this._icon.translation_x = 0;
        }

        _frameOverride() {
            if (!this._claudeReady) return null;
            const pose = this._pose();
            switch (pose) {
                case State.DRAGGING: return this._cycle([6, 7], 8);
                case State.CLIMB: return this._cycle([26, 27, 28, 29], 3);
                case State.JUMPING: return this._has(30) ? 30 : null;
                case State.FALLING: return this._has(31) ? 31 : null;
                case State.TYPING: return this._cycle([8, 9, 10, 11], 3);
                case State.THINKING: return this._cycle([12, 13, 14, 15], 5);
                case State.HAPPY: return this._cycle([16, 17, 18, 19], 3);
                case State.SLEEPING: return this._cycle([20, 21, 22, 23], 10);
                case State.SIT: return this._cycle([24, 25], 12);
                case State.ERROR: return this._has(31) ? 31 : (this._has(4) ? 4 : null);
                default: return null;
            }
        }

        _has(i) {
            return !!(this._frameImages && this._frameImages[i]);
        }

        _cycle(list, speed) {
            const avail = list.filter(i => this._has(i));
            if (avail.length === 0) return null;
            return avail[Math.floor(this._animationTimer / speed) % avail.length];
        }

        _windowAbove() {
            const feetX = this._x + this._displayW / 2;
            const feetY = this._y + this._displayH;
            for (const win of this._lastWindows) {
                const r = win.rect;
                const dist = feetY - r.y;
                if (dist > 0 && dist <= this._maxJumpHeight + this._displayH &&
                    feetX >= r.x - this._displayW && feetX <= r.x + r.width + this._displayW)
                    return true;
            }
            return false;
        }

        /** Maps physics state + mood to a pose; null means "use default frames". */
        _pose() {
            if (this._state === State.DRAGGING) return State.DRAGGING;
            if (this._state === State.JUMPING || this._state === State.FALLING) {
                if (this._mood === State.HAPPY) return State.HAPPY;
                if (this._vy < 0)
                    return (this._state === State.JUMPING && this._windowAbove()) ? State.CLIMB : State.JUMPING;
                return State.FALLING;
            }
            if (this._mood !== null) return this._mood;
            if (this._state === State.IDLE && (this._sitting || this._isFocusMode())) return State.SIT;
            return null;
        }

        // --- Mood / interaction helpers ----------------------------------------

        _setMood(mood, ticks) {
            this._mood = mood;
            this._moodTicks = ticks;
        }

        _wake() {
            this._idleTicks = 0;
            if (this._mood === State.SLEEPING) this._setMood(null, 0);
        }

        _anchorRect() {
            return { x: this._x, y: this._y, w: this._displayW, h: this._displayH };
        }

        /** Runs fn once on idle (tracked, removed on destroy). */
        _defer(fn) {
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._idleSources.delete(id);
                if (!this._destroyed) fn();
                return GLib.SOURCE_REMOVE;
            });
            this._idleSources.add(id);
        }

        // --- Pointer handling ---------------------------------------------------

        _onButtonPress(event) {
            if (this._destroyed) return Clutter.EVENT_PROPAGATE;
            const button = event.get_button();

            if (button === 3) {
                this._wake();
                this._toggleMenu();
                return Clutter.EVENT_STOP;
            }
            if (button !== 1) return Clutter.EVENT_PROPAGATE;
            // A previous press whose release never reached the stage (e.g. a grab
            // elsewhere, or the release happened over an X11 client): recover.
            if (this._pressing) this._releasePress(this._press ? this._press.x : 0, this._press ? this._press.y : 0, true);

            this._wake();
            const [x, y] = event.get_coords();
            this._press = { x, y, offX: x - this._x, offY: y - this._y };
            this._pressing = true;
            this._dragging = false;

            // Capture motion/release on the stage only while the button is down.
            global.stage.connectObject('captured-event',
                (stage, ev) => this._onStageEvent(ev), this);
            return Clutter.EVENT_STOP;
        }

        _onStageEvent(event) {
            if (!this._pressing || this._destroyed) return Clutter.EVENT_PROPAGATE;

            const type = event.type();
            if (type === Clutter.EventType.MOTION) {
                const [x, y] = event.get_coords();
                if (!(event.get_state() & Clutter.ModifierType.BUTTON1_MASK)) {
                    // Button 1 is no longer held: the release was missed. Never keep
                    // swallowing pointer motion in that case.
                    this._releasePress(x, y, true);
                    return Clutter.EVENT_PROPAGATE;
                }
                this._onPointerMove(x, y);
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE) {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                const [x, y] = event.get_coords();
                this._releasePress(x, y);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _onPointerMove(x, y) {
            if (!this._dragging) {
                const dx = x - this._press.x;
                const dy = y - this._press.y;
                if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
                this._beginDrag();
            }

            // Track history for the momentum toss (same units as the base class)
            const now = Date.now();
            this._dragHistory.push({ x, y, time: now });
            while (this._dragHistory.length > 0 && now - this._dragHistory[0].time > 200)
                this._dragHistory.shift();

            const prevX = this._x;
            this._x = x - this._press.offX;
            this._y = y - this._press.offY;
            if (this._x !== prevX) this._setFacing(this._x > prevX);
            this.actor.set_position(Math.floor(this._x), Math.floor(this._y));
        }

        _beginDrag() {
            this._dragging = true;
            this._state = State.DRAGGING;
            this._vx = 0;
            this._vy = 0;
            this._dragHistory = [];
            this._dropTime = 0;
            this._setMood(null, 0);

            // Lift the dragged pet into the chrome layer (it may be in window_group or
            // the background group, i.e. behind windows); _endDrag() restores the layer.
            const lm = Main.layoutManager;
            const parent = this.actor.get_parent();
            if (parent !== lm.uiGroup) {
                if (parent) parent.remove_child(this.actor);
                lm.addChrome(this.actor);
            }
            lm.uiGroup.set_child_above_sibling(this.actor, null);
            this._updateAnimation();
        }

        /** Ends the press (click or drag). Idempotent. `aborted` = no click. */
        _releasePress(x, y, aborted = false) {
            if (!this._pressing) return;
            const wasDragging = this._dragging;
            this._endPressTracking();

            if (wasDragging) {
                this._endDrag();
                return;
            }
            if (aborted) return;

            if (!this._settings.get_boolean('claude-chat-enabled')) {
                this._onClick();
                return;
            }

            // Double click = open the prompt. The single-click hop is delayed until
            // the double-click window has passed, so the pet does not jump away from
            // under the pointer before the second click.
            const near = Math.hypot(x - this._lastClickX, y - this._lastClickY) <= DRAG_THRESHOLD_PX;
            if (this._clickTimeoutId && near) {
                this._clearClickTimeout();
                this.openPrompt();
                return;
            }
            this._clearClickTimeout();
            this._lastClickX = x;
            this._lastClickY = y;
            this._clickTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DOUBLE_CLICK_MS, () => {
                this._clickTimeoutId = 0;
                if (!this._destroyed) this._onClick();
                return GLib.SOURCE_REMOVE;
            });
        }

        _clearClickTimeout() {
            if (this._clickTimeoutId) {
                GLib.source_remove(this._clickTimeoutId);
                this._clickTimeoutId = 0;
            }
        }

        /** Disconnects the stage capture and clears press state. Idempotent. */
        _endPressTracking() {
            global.stage.disconnectObject(this);
            this._pressing = false;
            this._press = null;
        }

        _endDrag() {
            this._dragging = false;
            this._dropTime = Date.now();
            this._state = State.FALLING;

            const momentum = this._calculateMomentum();
            this._vx = momentum.vx;
            this._vy = momentum.vy;
            this._dragHistory = [];

            // Same layer logic as the base class after a drag
            this._resetLayer();
            this._updateAnimation();
        }

        _onClick() {
            this._wake();
            if (this._state === State.DRAGGING) return;

            // Happy hop
            const grounded = this._state === State.IDLE || this._state === State.WALKING;
            if (grounded) {
                this._state = State.JUMPING;
                this._vy = this._jumpVelocity * 0.6;
                this._vx = 0;
            }
            if (!this._requestActive && (this._mood === null || this._mood === State.HAPPY ||
                this._mood === State.SLEEPING))
                this._setMood(State.HAPPY, 30);

            this._spawnSparkles();
            this._speech.say(this._sessionMessage || QUIPS[Math.floor(Math.random() * QUIPS.length)], 4000);
        }

        // --- Sparkles ------------------------------------------------------------

        _spawnSparkles() {
            if (this._destroyed) return;
            const cx = this._x + this._displayW / 2;
            const cy = this._y + this._displayH * 0.3;

            for (let i = 0; i < 8; i++) {
                const size = Math.random() < 0.5 ? 4 : 6;
                const color = SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
                const spark = new St.Widget({
                    style: `background-color: ${color}; width: ${size}px; height: ${size}px;`,
                    reactive: false,
                    x: cx,
                    y: cy,
                    opacity: 255,
                });
                Main.layoutManager.uiGroup.add_child(spark);
                this._sparkles.add(spark);

                const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
                const dist = 24 + Math.random() * 24;
                spark.ease({
                    x: cx + Math.cos(angle) * dist,
                    y: cy + Math.sin(angle) * dist - 10,
                    opacity: 0,
                    duration: 500 + Math.random() * 300,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => this._removeSparkle(spark),
                });
            }
        }

        _removeSparkle(spark) {
            if (!this._sparkles.delete(spark)) return;
            spark.remove_all_transitions();
            spark.destroy();
        }

        // --- Context menu ----------------------------------------------------------

        _ensureMenu() {
            if (this._menu) return;

            this._menu = new PopupMenu.PopupMenu(this.actor, 0.5, St.Side.BOTTOM);
            Main.layoutManager.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();
            this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
            this._menuManager.addMenu(this._menu);

            const ask = new PopupMenu.PopupMenuItem('Ask Claude...');
            ask.connectObject('activate', () => this._defer(() => this._menuAsk()), this);
            this._menu.addMenuItem(ask);

            const spawn = new PopupMenu.PopupMenuItem('Spawn Claude Pet');
            spawn.connectObject('activate', () => {
                if (this._callbacks.spawnPet) this._callbacks.spawnPet();
            }, this);
            this._menu.addMenuItem(spawn);

            const dismiss = new PopupMenu.PopupMenuItem('Dismiss Pet');
            dismiss.connectObject('activate', () => this._defer(() => {
                if (this._callbacks.dismissPet) this._callbacks.dismissPet(this);
            }), this);
            this._menu.addMenuItem(dismiss);

            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._focusItem = new PopupMenu.PopupSwitchMenuItem('Focus Mode',
                this._settings.get_boolean('focus-mode'));
            this._focusItem.connectObject('toggled', (item, state) => {
                this._settings.set_boolean('focus-mode', state);
            }, this);
            this._menu.addMenuItem(this._focusItem);
        }

        _menuAsk() {
            if (this._settings.get_boolean('claude-chat-enabled')) {
                this.openPrompt();
            } else {
                this._speech.say('Chat is disabled in the extension settings.', 4000);
            }
        }

        _toggleMenu() {
            this._ensureMenu();
            if (this._menu.isOpen) {
                this._menu.close(false);
            } else {
                this._focusItem.setToggleState(this._settings.get_boolean('focus-mode'));
                this._menu.open(false);
            }
        }

        // --- Prompt / Claude CLI ------------------------------------------------------

        openPrompt() {
            if (this._destroyed || this._input) return;
            this._speech.hide();
            this._input = new InputBubble({
                onSubmit: text => this._askClaude(text),
                onClose: () => { this._input = null; },
            });
            this._input.open(this._anchorRect());
        }

        _askClaude(text) {
            if (this._destroyed) return;
            if (this._requestActive || this._runner.busy) {
                this._speech.say('Still working on the previous request...', 3000);
                return;
            }
            this._wake();
            this._response.hide();
            this._requestActive = true;
            this._thinkTicks = 0;
            this._sessionMessage = null;
            this._setMood(State.THINKING, MOOD_PERSIST);
            this._runner.run(text, result => this._onClaudeResult(result));
        }

        _onClaudeResult(result) {
            if (this._destroyed || !this.actor) return;
            this._requestActive = false;
            this._thinkTicks = 0;
            const rect = this._anchorRect();

            switch (result.kind) {
                case 'ok': {
                    const out = truncate(cleanOutput(result.stdout).trim(), MAX_STDOUT_CHARS);
                    this._response.show(out || '(no output)', rect);
                    this._setMood(State.HAPPY, 60);
                    break;
                }
                case 'missing':
                    this._speech.say('claude CLI not found - install it and make sure it is in PATH', 8000);
                    this._setMood(State.ERROR, 60);
                    break;
                case 'failed': {
                    const err = truncate(cleanOutput(result.stderr || result.stdout || '').trim(), MAX_STDERR_CHARS);
                    this._response.show(`claude exited with status ${result.status}${err ? `:\n${err}` : ''}`, rect);
                    this._setMood(State.ERROR, 60);
                    break;
                }
                case 'timeout':
                    this._response.show(`claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s and was stopped.`, rect);
                    this._setMood(State.ERROR, 60);
                    break;
                default:
                    this._response.show(
                        truncate(cleanOutput(`Could not run claude: ${result.message || 'unknown error'}`), MAX_STDERR_CHARS), rect);
                    this._setMood(State.ERROR, 60);
                    break;
            }
        }

        // --- External session state ------------------------------------------------------

        /**
         * Applies an already validated state from the state file.
         */
        applySessionState(state, message) {
            if (this._destroyed || !this.actor) return;
            this._wake();
            if (this._requestActive) return; // A direct request takes priority

            const text = sanitizeText(message || SESSION_DEFAULT_TEXT[state] || '');
            switch (state) {
                case 'thinking':
                    this._setMood(State.THINKING, MOOD_PERSIST);
                    this._sessionMessage = text;
                    break;
                case 'typing':
                    this._setMood(State.TYPING, MOOD_PERSIST);
                    this._sessionMessage = text;
                    break;
                case 'done':
                    this._setMood(State.HAPPY, REVERT_TICKS);
                    this._sessionMessage = null;
                    break;
                case 'error':
                    this._setMood(State.ERROR, REVERT_TICKS);
                    this._sessionMessage = null;
                    break;
                default:
                    return;
            }
            if (text) this._speech.say(text, 6000);
        }

        // --- Lifecycle ---------------------------------------------------------------------

        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;

            if (this._runner) {
                this._runner.destroy();
                this._runner = null;
            }

            // Release pointer capture
            global.stage.disconnectObject(this);
            this._pressing = false;
            this._dragging = false;
            this._press = null;
            this._clearClickTimeout();

            for (const id of this._idleSources) GLib.source_remove(id);
            this._idleSources.clear();

            for (const spark of [...this._sparkles]) {
                this._sparkles.delete(spark);
                spark.remove_all_transitions();
                spark.destroy();
            }

            if (this._input) {
                this._input.destroy(); // releases the modal grab
                this._input = null;
            }
            if (this._speech) {
                this._speech.destroy();
                this._speech = null;
            }
            if (this._response) {
                this._response.destroy();
                this._response = null;
            }

            if (this._menu) {
                this._menu.close(false);
                if (this._menuManager) this._menuManager.removeMenu(this._menu);
                this._menu.destroy();
                this._menu = null;
                this._menuManager = null;
                this._focusItem = null;
            }

            if (this.actor) {
                this.actor.disconnectObject(this);
                this.actor.remove_all_transitions();
                this._icon.remove_all_transitions();
            }

            this._callbacks = {};
            super.destroy();
        }
    });
