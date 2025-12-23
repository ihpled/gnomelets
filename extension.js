import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { GnomeletManager } from './manager.js';
import { GnomeletIndicator } from './indicator.js';

/**
 * Extension Entry Point
 */
export default class DesktopGnomeletsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._manager = new GnomeletManager(this._settings);
        this._manager.enable();
        this._indicator = new GnomeletIndicator(this);
        Main.panel.addToStatusArea('gnomelets-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._manager) {
            this._manager.disable();
            this._manager = null;
        }

        this._settings = null;
    }
}