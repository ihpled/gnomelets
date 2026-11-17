import Gio from 'gi://Gio';

import { CLAUDE_STATE_FILE } from './utils.js';

const VALID_STATES = new Set(['thinking', 'typing', 'done', 'error']);
const MAX_MESSAGE_LEN = 200;
const MAX_FILE_BYTES = 8192;

/**
 * Sanitizes untrusted text: strips control characters, caps length.
 * The result is only ever displayed as plain text.
 */
export function sanitizeText(value, maxLen = MAX_MESSAGE_LEN) {
    return String(value)
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLen);
}

/**
 * Watches /tmp/gnomelets-claude-state.json (written by external tooling such
 * as a Claude Code hook) and reports validated {state, message} updates.
 * The file content is untrusted. Never blocks: monitor + async reads only.
 */
export class ClaudeStateWatcher {
    constructor(onUpdate) {
        this._onUpdate = onUpdate;
        this._destroyed = false;
        this._monitor = null;
        this._cancellable = null;
        this._lastRaw = null;
        this._reading = false;
        this._rereadPending = false;
    }

    get active() {
        return !!this._monitor;
    }

    start() {
        if (this._destroyed || this._monitor) return;

        this._cancellable = new Gio.Cancellable();
        const file = Gio.File.new_for_path(CLAUDE_STATE_FILE);
        try {
            // Works even if the file does not exist yet (watches the path).
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, this._cancellable);
        } catch (e) {
            this._cancellable.cancel();
            this._cancellable = null;
            this._monitor = null;
            return;
        }
        this._monitor.connectObject('changed', (monitor, f, other, eventType) => {
            if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                eventType === Gio.FileMonitorEvent.CREATED ||
                eventType === Gio.FileMonitorEvent.CHANGED)
                this._read();
        }, this);
    }

    /**
     * Stops monitoring (idempotent). The watcher can be start()ed again.
     */
    stop() {
        if (this._monitor) {
            this._monitor.disconnectObject(this);
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        this._reading = false;
        this._rereadPending = false;
        this._lastRaw = null;
    }

    _read() {
        if (this._destroyed || !this._cancellable) return;
        if (this._reading) {
            this._rereadPending = true;
            return;
        }
        this._reading = true;
        const cancellable = this._cancellable;
        const file = Gio.File.new_for_path(CLAUDE_STATE_FILE);
        file.load_contents_async(cancellable, (f, res) => {
            if (this._destroyed || cancellable.is_cancelled() || this._cancellable !== cancellable)
                return;
            this._reading = false;

            let raw = null;
            try {
                const [ok, contents] = f.load_contents_finish(res);
                if (ok && contents.length <= MAX_FILE_BYTES)
                    raw = new TextDecoder('utf-8').decode(contents);
            } catch (e) {
                // Missing/unreadable file (e.g. deleted): ignore
            }

            if (raw !== null)
                this._handleRaw(raw);

            if (this._rereadPending) {
                this._rereadPending = false;
                this._read();
            }
        });
    }

    _handleRaw(raw) {
        if (raw === this._lastRaw) return; // Debounce identical consecutive payloads
        this._lastRaw = raw;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        if (typeof data.state !== 'string' || !VALID_STATES.has(data.state)) return;

        let message = '';
        if (data.message !== undefined && data.message !== null) {
            if (typeof data.message !== 'string') return;
            message = sanitizeText(data.message);
        }

        if (this._onUpdate) this._onUpdate(data.state, message);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.stop();
        this._onUpdate = null;
    }
}
