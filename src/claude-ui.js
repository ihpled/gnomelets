import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Pixel-style UI helpers for the Claude pet: speech bubble, prompt bubble
 * and response bubble. All bubbles live in uiGroup (addChrome/removeChrome),
 * are plain text only (no markup) and are fully torn down by destroy().
 */

const BORDER = '#d97757';
const BUBBLE_STYLE =
    `background-color: #1e1e2e; color: #f5e0dc; border: 2px solid ${BORDER}; border-radius: 0px; ` +
    'padding: 6px 8px; font-family: monospace; font-size: 11px; max-width: 280px;';
const BUTTON_STYLE =
    `background-color: #313244; color: #f5e0dc; border: 2px solid ${BORDER}; border-radius: 0px; ` +
    'padding: 1px 6px; font-family: monospace; font-size: 11px;';

function _makeLabel(text, style = '') {
    const label = new St.Label({ text, style });
    label.clutter_text.use_markup = false;
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return label;
}

function _monitorFor(cx, cy) {
    const monitors = Main.layoutManager.monitors || [];
    for (const m of monitors) {
        if (cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height)
            return m;
    }
    return Main.layoutManager.primaryMonitor || { x: 0, y: 0, width: global.stage.width, height: global.stage.height };
}

/**
 * Places `actor` above `rect` ({x, y, w, h}), flipping below if there is no room,
 * and clamps it to the monitor.
 */
function _placeNear(actor, rect) {
    const [, natW] = actor.get_preferred_width(-1);
    const [, natH] = actor.get_preferred_height(natW);
    const mon = _monitorFor(rect.x + rect.w / 2, rect.y + rect.h / 2);

    let x = rect.x + rect.w / 2 - natW / 2;
    let y = rect.y - natH - 6;
    if (y < mon.y) y = rect.y + rect.h + 6;

    x = Math.max(mon.x, Math.min(x, mon.x + mon.width - natW));
    y = Math.max(mon.y, Math.min(y, mon.y + mon.height - natH));
    actor.set_position(Math.floor(x), Math.floor(y));
}

function _destroyChrome(actor) {
    if (!actor) return;
    actor.remove_all_transitions();
    try {
        Main.layoutManager.removeChrome(actor);
    } catch (e) {
        // Not tracked (already removed): fall through to destroy
    }
    actor.destroy();
}

/**
 * Non-interactive auto-fading speech bubble.
 */
export class SpeechBubble {
    constructor() {
        this._destroyed = false;
        this._box = null;
        this._label = null;
        this._timeoutId = 0;
    }

    get visible() {
        return !!this._box && this._box.visible && this._box.opacity > 0;
    }

    _ensure() {
        if (this._box) return;
        this._box = new St.BoxLayout({
            style: BUBBLE_STYLE,
            reactive: false,
            visible: false,
            opacity: 0,
        });
        this._label = _makeLabel('');
        this._box.add_child(this._label);
        Main.layoutManager.addChrome(this._box, { affectsInputRegion: false });
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    /**
     * Shows plain text. durationMs <= 0 keeps it until hide()/next say().
     */
    say(text, durationMs = 5000) {
        if (this._destroyed) return;
        this._ensure();
        this._clearTimeout();
        this._box.remove_all_transitions();
        this._label.text = String(text);
        this._box.show();
        this._box.ease({
            opacity: 255,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        if (durationMs > 0) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, durationMs, () => {
                this._timeoutId = 0;
                this.hide();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    hide() {
        if (this._destroyed || !this._box) return;
        this._clearTimeout();
        this._box.remove_all_transitions();
        this._box.ease({
            opacity: 0,
            duration: 400,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._destroyed && this._box) this._box.hide();
            },
        });
    }

    /** Hides immediately, without animation. Cheap no-op if already hidden. */
    hideNow() {
        if (this._destroyed || !this._box || !this._box.visible) return;
        this._clearTimeout();
        this._box.remove_all_transitions();
        this._box.opacity = 0;
        this._box.hide();
    }

    reposition(rect) {
        if (this._destroyed || !this._box || !this._box.visible) return;
        _placeNear(this._box, rect);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._clearTimeout();
        _destroyChrome(this._box);
        this._box = null;
        this._label = null;
    }
}

/**
 * Prompt bubble with a text entry. Enter submits, Esc / x closes.
 * Uses a modal grab (needed for keyboard input) which is released on every
 * close path (submit, Esc, x, destroy()).
 */
export class InputBubble {
    constructor({ onSubmit, onClose }) {
        this._onSubmit = onSubmit;
        this._onClose = onClose;
        this._box = null;
        this._entry = null;
        this._grab = null;
        this._closed = false;
        this._lastRect = null;
    }

    get isOpen() {
        return !!this._box && !this._closed;
    }

    open(rect) {
        if (this._box || this._closed) return;

        this._box = new St.BoxLayout({
            vertical: true,
            style: BUBBLE_STYLE,
            reactive: true,
            can_focus: false,
        });

        const header = new St.BoxLayout({ vertical: false });
        const title = new St.Label({
            text: 'Ask Claude',
            x_expand: true,
            style: `color: ${BORDER};`,
        });
        title.clutter_text.use_markup = false;
        const closeBtn = new St.Button({
            label: 'x',
            reactive: true,
            can_focus: true,
            style: BUTTON_STYLE,
        });
        closeBtn.connectObject('clicked', () => this.close(), this);
        header.add_child(title);
        header.add_child(closeBtn);
        this._box.add_child(header);

        this._entry = new St.Entry({
            hint_text: 'Type a question, Enter to send',
            can_focus: true,
            reactive: true,
            style: 'min-width: 240px; font-family: monospace; font-size: 11px; border-radius: 0px;',
        });
        this._entry.clutter_text.use_markup = false;
        this._entry.clutter_text.connectObject(
            'activate', () => this._submit(),
            'key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            },
            this);
        this._box.add_child(this._entry);

        Main.layoutManager.addChrome(this._box);
        this._lastRect = rect;
        if (rect) _placeNear(this._box, rect);

        // Keyboard input needs a modal grab. Released in close().
        try {
            this._grab = Main.pushModal(this._box) || null;
        } catch (e) {
            this._grab = null;
        }
        this._entry.grab_key_focus();
    }

    reposition(rect) {
        if (!this._box || this._closed) return;
        this._lastRect = rect;
        _placeNear(this._box, rect);
    }

    _submit() {
        if (!this._entry) return;
        const text = this._entry.get_text().trim();
        if (!text) return;
        const cb = this._onSubmit;
        this.close();
        if (cb) cb(text);
    }

    /**
     * Idempotent. Releases modal grab, destroys actors, notifies owner once.
     */
    close() {
        if (this._closed) return;
        this._closed = true;

        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                // Grab already dismissed
            }
            this._grab = null;
        }

        if (this._box) {
            if (this._entry) this._entry.clutter_text.disconnectObject(this);
            _destroyChrome(this._box);
        }
        this._box = null;
        this._entry = null;

        const cb = this._onClose;
        this._onClose = null;
        this._onSubmit = null;
        if (cb) cb();
    }

    destroy() {
        this.close();
    }
}

/**
 * Scrollable response bubble with Copy and Close buttons.
 */
export class ResponseBubble {
    constructor() {
        this._destroyed = false;
        this._box = null;
        this._label = null;
        this._copyBtn = null;
        this._text = '';
    }

    get visible() {
        return !!this._box && this._box.visible;
    }

    _ensure() {
        if (this._box) return;
        this._box = new St.BoxLayout({
            vertical: true,
            style: BUBBLE_STYLE + ' max-width: 440px;',
            reactive: true,
            visible: false,
        });

        const header = new St.BoxLayout({ vertical: false, style: 'spacing: 6px;' });
        const title = new St.Label({
            text: 'Claude',
            x_expand: true,
            style: `color: ${BORDER};`,
        });
        title.clutter_text.use_markup = false;
        this._copyBtn = new St.Button({
            label: 'Copy',
            reactive: true,
            can_focus: true,
            style: BUTTON_STYLE,
        });
        this._copyBtn.connectObject('clicked', () => this._copy(), this);
        const closeBtn = new St.Button({
            label: 'x',
            reactive: true,
            can_focus: true,
            style: BUTTON_STYLE,
        });
        closeBtn.connectObject('clicked', () => this.hide(), this);
        header.add_child(title);
        header.add_child(this._copyBtn);
        header.add_child(closeBtn);
        this._box.add_child(header);

        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style: 'max-height: 240px; min-width: 280px;',
            reactive: true,
        });
        const inner = new St.BoxLayout({ vertical: true });
        this._label = _makeLabel('', 'max-width: 400px;');
        inner.add_child(this._label);
        // GNOME 45: St.ScrollView is an St.Bin (set_child); 46+: it has its own
        // set_child()/child property. add_child() does not wire up scrolling on 46+.
        scroll.set_child(inner);
        this._box.add_child(scroll);

        Main.layoutManager.addChrome(this._box);
    }

    _copy() {
        if (this._destroyed) return;
        try {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._text);
            if (this._copyBtn) this._copyBtn.label = 'Copied';
        } catch (e) {
            // Clipboard unavailable
        }
    }

    show(text, rect) {
        if (this._destroyed) return;
        this._ensure();
        this._text = String(text);
        this._label.text = this._text;
        if (this._copyBtn) this._copyBtn.label = 'Copy';
        this._box.show();
        if (rect) _placeNear(this._box, rect);
    }

    hide() {
        if (this._destroyed || !this._box) return;
        this._box.hide();
    }

    reposition(rect) {
        if (this._destroyed || !this._box || !this._box.visible) return;
        _placeNear(this._box, rect);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        _destroyChrome(this._box);
        this._box = null;
        this._label = null;
        this._copyBtn = null;
    }
}
