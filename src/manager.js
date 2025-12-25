import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Gnomelet } from './gnomelet.js';
import { isWindowMaximized, UPDATE_INTERVAL_MS } from './utils.js';

/**
 * GnomeletManager Class
 * Orchestrates the lifecycle of all characters and global resources.
 */
export const GnomeletManager = GObject.registerClass(
    class GnomeletManager extends GObject.Object {
        _init(settings) {
            super._init();
            this._gnomelets = [];
            this._settings = settings;
            this._windows = [];
            this._timerId = 0;
            this._cancellable = null;

            // Resource cache: { [type: string]: { frames: GIcon[], w: int, h: int } }
            this._resources = {};
            this._cacheFile = GLib.get_user_cache_dir() + '/gnomelets-state.json';
            this._pendingState = null;
            this._isPaused = !this._settings.get_boolean('is-enabled');
        }

        /**
         * Helper to resolve the correct folder for a given type name asynchronously.
         */
        _resolveImageFolderAsync(typeName, callback) {
            if (!typeName) {
                callback(null);
                return;
            }

            let file = Gio.File.new_for_uri(import.meta.url);
            let imagesDir = file.get_parent().get_child('images');
            let typeDir = imagesDir.get_child(typeName);

            typeDir.query_info_async(
                Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                (obj, res) => {
                    try {
                        let info = obj.query_info_finish(res);
                        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                            callback(typeDir);
                        } else {
                            callback(null);
                        }
                    } catch (e) {
                        callback(null);
                    }
                }
            );
        }

        /**
         * Loads resources and spawns gnomelets.
         */
        async _loadResourcesAndSpawn(hardReset = false) {
            let types = this._settings.get_strv('gnomelet-type');
            if (!types || types.length === 0) types = ['Santa'];

            let loadedSomething = false;

            const loadType = async (typeName) => {
                if (this._resources[typeName]) return; // Already loaded

                return new Promise((resolve) => {
                    this._resolveImageFolderAsync(typeName, async (typeDir) => {
                        if (!typeDir) { resolve(); return; }

                        let frames = [];
                        let frameW = 0;
                        let frameH = 0;
                        let anySuccess = false;

                        const loadFrame = (index) => {
                            return new Promise((r) => {
                                let imgFile = typeDir.get_child(`${index}.png`);
                                imgFile.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
                                    try {
                                        let stream = file.read_finish(res);
                                        GdkPixbuf.Pixbuf.new_from_stream_async(stream, this._cancellable, (source, res2) => {
                                            try {
                                                let pixbuf = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
                                                stream.close(null);
                                                r({
                                                    valid: true,
                                                    w: pixbuf.get_width(),
                                                    h: pixbuf.get_height(),
                                                    icon: new Gio.FileIcon({ file: imgFile })
                                                });
                                            } catch (e) {
                                                try { stream.close(null); } catch (err) { }
                                                r({ valid: false });
                                            }
                                        });
                                    } catch (e) {
                                        r({ valid: false });
                                    }
                                });
                            });
                        };

                        let promises = [];
                        for (let i = 0; i < 6; i++) promises.push(loadFrame(i));

                        let results = await Promise.all(promises);
                        for (let res of results) {
                            if (res && res.valid) {
                                frames.push(res.icon);
                                if (frameW === 0) {
                                    frameW = res.w;
                                    frameH = res.h;
                                }
                                anySuccess = true;
                            } else {
                                frames.push(null);
                            }
                        }

                        if (anySuccess && frameW > 0 && frameH > 0) {
                            this._resources[typeName] = { frames, w: frameW, h: frameH };
                            loadedSomething = true;
                        }
                        resolve();
                    });
                });
            };

            // Load all selected types
            await Promise.all(types.map(t => loadType(t)));

            if (hardReset) this._hardReset();
            else this._spawnGnomelets(null);
        }

        get isVisualizationEnabled() {
            return !this._isPaused;
        }

        /**
         * Toggles the visualization state.
         */
        toggleVisualization() {
            let current = this._settings.get_boolean('is-enabled');
            this._settings.set_boolean('is-enabled', !current);
        }

        /**
         * Starts the update timer if not already running.
         * Prevents duplicate timers and ensures single source of truth.
         */
        _startTimer() {
            if (this._timerId) return;

            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
        }

        /**
         * Stops the update timer if running.
         */
        _stopTimer() {
            if (this._timerId) {
                GLib.source_remove(this._timerId);
                this._timerId = 0;
            }
        }

        /**
         * Enables manager, listeners, and the main timer.
         */
        enable() {
            this._cancellable = new Gio.Cancellable();
            this._settings.connectObject('changed', this._onSettingsChanged.bind(this), this);

            // Monitor system scale changes
            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                themeContext.connectObject('notify::scale-factor',
                    () => this._updateScale(), this);
            }

            // Async load: Start loading state asynchronously.
            // The gnomelets will spawn in the callback.
            this._loadStateAsync();

            if (!this._isPaused) {
                this._startTimer();
            }
        }

        _onSettingsChanged(settings, key) {
            if (key === 'gnomelet-count') this._updateCount();
            else if (key === 'gnomelet-scale') this._updateScale();
            else if (key === 'gnomelet-type') {
                // Trigger async load and reset
                this._loadResourcesAndSpawn(true);
            } else if (key === 'reset-trigger') {
                this._hardReset();
            } else if (key === 'is-enabled') {
                this._updateEnabledState();
            } else if (key === 'allow-interaction') {
                this._updateInteractions();
            }
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

            let themeContext = St.ThemeContext.get_for_stage(global.stage);
            if (themeContext) {
                themeContext.disconnectObject(this);
            }

            this._saveState();
            this._stopTimer();

            this._settings.disconnectObject(this);
            this._destroyGnomelets();
            this._resources = {};
        }

        /**
         * Loads saved state from JSON cache file asynchronously.
         * When done, it triggers resource loading, then spawning.
         */
        _loadStateAsync() {
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

                this._pendingState = savedState;
                this._loadResourcesAndSpawn(false);
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
        _pickResource(typeName = null) {
            if (typeName && this._resources[typeName]) {
                let res = this._resources[typeName];
                return { type: typeName, frames: res.frames, w: res.w, h: res.h };
            }

            // Random from selected
            let selectedTypes = this._settings.get_strv('gnomelet-type');
            if (!selectedTypes || selectedTypes.length === 0) selectedTypes = ['Santa'];
            // Filter those that are actually loaded
            let valid = selectedTypes.filter(t => this._resources[t]);

            // If none of selected are loaded just return null.
            if (valid.length === 0) return null;

            let t = valid[Math.floor(Math.random() * valid.length)];
            let res = this._resources[t];
            return { type: t, frames: res.frames, w: res.w, h: res.h };
        }

        /**
         * Adds or removes characters based on settings count.
         */
        _updateCount() {
            if (this._isPaused) return;
            let count = this._settings.get_int('gnomelet-count');
            let current = this._gnomelets.length;

            if (count > current) {
                for (let i = 0; i < (count - current); i++) {
                    let res = this._pickResource();
                    if (!res) break;
                    // Bind resource provider
                    let provider = (t) => this._pickResource(t);
                    this._gnomelets.push(new Gnomelet(res.type, res.frames, res.w, res.h, this._settings, provider));
                }
            } else if (count < current) {
                for (let i = 0; i < (current - count); i++) {
                    let p = this._gnomelets.pop();
                    p.destroy();
                }
            }
        }

        _spawnGnomelets(savedState) {
            if (this._isPaused) return;
            if (!this._cancellable || this._cancellable.is_cancelled()) return;

            let count = this._settings.get_int('gnomelet-count');

            // Ensure we have at least one resource loaded
            let res = this._pickResource();
            if (!res) {
                this._loadResourcesAndSpawn(false);
                return;
            }

            if (this._gnomelets.length > 0) this._destroyGnomelets();

            let stateToUse = savedState || this._pendingState;
            this._pendingState = null;

            // Shared provider reference
            let provider = (t) => this._pickResource(t);

            for (let i = 0; i < count; i++) {
                // Priority: Saved Type -> Random
                let specificType = null;
                if (stateToUse && stateToUse[i] && stateToUse[i].type) {
                    specificType = stateToUse[i].type;
                }

                let instanceRes = this._pickResource(specificType);

                if (!instanceRes) instanceRes = this._pickResource(); // Fallback if somehow both failed (e.g. valid types empty)
                if (!instanceRes) break;

                let p = new Gnomelet(instanceRes.type, instanceRes.frames, instanceRes.w, instanceRes.h, this._settings, provider);
                if (stateToUse && stateToUse[i]) p.deserialize(stateToUse[i]);
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
                let actors = global.window_group.get_children();
                let focusWindow = global.display.focus_window;
                let floorMode = this._settings.get_string('floor-z-order');

                // Helper to check maximization
                const isMax = (w) => w && !w.minimized &&
                    w.get_window_type() === Meta.WindowType.NORMAL &&
                    isWindowMaximized(w);

                // 1. Gather Key Indices
                let focusedIndex = -1;
                let maximizedIndices = [];

                for (let i = 0; i < actors.length; i++) {
                    let actor = actors[i];
                    if (!actor.visible || !actor.meta_window) continue;

                    if (actor.meta_window === focusWindow) {
                        focusedIndex = i;
                    }
                    if (isMax(actor.meta_window)) {
                        maximizedIndices.push(i);
                    }
                }

                // 2. Determine Filter Bounds & Background Mode
                // We want to accept windows with index I where: minIndex < I < maxIndex
                let minIndex = -1;
                let maxIndex = actors.length;
                let forceBackground = false;

                let focusedIsMaximized = (focusedIndex !== -1) && isMax(actors[focusedIndex].meta_window);

                if (floorMode === 'partial') {
                    if (focusedIsMaximized) {
                        // PARTIAL (Maximized Focus):
                        // Range: (Previous Max) < I < (Focused Max)
                        // If no previous max, minIndex = -1.
                        forceBackground = true;
                        maxIndex = focusedIndex;

                        // Find closest max index smaller than focusedIndex
                        let prevMax = -1;
                        for (let idx of maximizedIndices) {
                            if (idx < focusedIndex) prevMax = idx;
                            else break; // maximizingIndices is sorted ascending because we pushed in loop I=0..N
                        }
                        minIndex = prevMax;

                    } else {
                        // PARTIAL (Unmaximized Focus) -> Acts like ALLOW
                        forceBackground = false;
                        if (maximizedIndices.length > 0) {
                            // Occlusion: Ignore windows below the TOPMOST maximized window
                            minIndex = maximizedIndices[maximizedIndices.length - 1];
                        }
                    }
                } else if (floorMode === 'disallow') {
                    // DISALLOW:
                    // Range: I < (Bottommost Max)
                    if (maximizedIndices.length > 0) {
                        forceBackground = true;
                        maxIndex = maximizedIndices[0]; // First one found is bottommost
                    } else {
                        forceBackground = false; // No maximized windows, behave normally
                    }

                } else {
                    // ALLOW:
                    // Range: I > (Topmost Max) (Occlusion logic)
                    forceBackground = false;
                    if (maximizedIndices.length > 0) {
                        minIndex = maximizedIndices[maximizedIndices.length - 1];
                    }
                }

                // 3. Collect Valid Windows
                for (let i = 0; i < actors.length; i++) {
                    // Strict bounds check
                    if (i <= minIndex || i >= maxIndex) continue;

                    let actor = actors[i];
                    if (!actor.visible || !actor.meta_window) continue;
                    if (actor.meta_window.minimized || isMax(actor.meta_window)) continue;

                    let rect = actor.meta_window.get_frame_rect();
                    this._windows.push({ rect, actor });
                }

                // 4. (New) Find Dash-to-Dock
                // Logic to determine if Dash-to-Dock is a VALID landing surface
                let allowDock = true;
                let dashContainer = null;
                let hasMaximized = maximizedIndices.length > 0;

                if (hasMaximized) {
                    if (floorMode === 'disallow') {
                        allowDock = false;
                    } else if (floorMode === 'partial') {
                        // Only allow if focused window exists and is NOT maximized
                        let focusedUnique = (focusedIndex !== -1);
                        if (!focusedUnique || focusedIsMaximized) {
                            allowDock = false;
                        }
                    }
                }

                // New Option: In Front of Dash to Dock
                // We no longer prevent landing if dock-z-order is false.
                // The z-order is handled purely in the gnomelet drawing logic.

                // Dash-to-Dock places its main container (DashToDock) in uiGroup.
                // We identify it by its constructor name.
                let uiChildren = Main.layoutManager.uiGroup.get_children();
                searchLoop:
                for (let child of uiChildren) {
                    if (child.visible && child.mapped && child.constructor && child.constructor.name === 'DashToDock') {
                        dashContainer = child;

                        if (allowDock) {
                            let dashToDock = child;
                            for (let subChild of dashToDock.get_children()) {
                                // DashSlideContainer is the main non-transparent container for the dock
                                if (subChild.constructor && subChild.constructor.name === 'DashSlideContainer') {
                                    let [x, y] = subChild.get_transformed_position();
                                    let [w, h] = subChild.get_transformed_size();

                                    // Only count it if it has dimensions
                                    if (w > 0 && h > 0) {
                                        // Create a rect object compatible with Meta.Window rect interface (x, y, width, height)
                                        let rect = { x: Math.floor(x), y: Math.floor(y), width: Math.floor(w), height: Math.floor(h) };
                                        this._windows.push({ rect, actor: subChild, isDock: true });
                                    }
                                    // Found it, no need to search further
                                    break searchLoop;
                                }
                            }
                        }
                        // Found it, no need to search further
                        break;
                    }
                }

                for (let p of this._gnomelets) p.update(this._windows, forceBackground, dashContainer);
            } catch (e) {
                console.error(e);
            }
        }

        _updateInteractions() {
            for (let p of this._gnomelets) {
                p._updateInteraction();
            }
        }

        /**
         * Updates the enabled state of the extension.
         */
        _updateEnabledState() {
            let enabled = this._settings.get_boolean('is-enabled');
            this._isPaused = !enabled;

            if (this._isPaused) {
                this._stopTimer();
                this._destroyGnomelets();
            } else {
                this._startTimer();
                // If we have pending state (e.g. from initial load), it will be used.
                // Otherwise, normal spawn.
                this._spawnGnomelets(null);
            }
        }
    });
