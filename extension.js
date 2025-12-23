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

        this._indicator = null;
        this._settings.connectObject('changed::show-indicator',
            () => this._updateIndicator(), this);

        this._updateIndicator();
    }

    disable() {
        if (this._settings) {
            this._settings.disconnectObject(this);
            this._settings = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._manager) {
            this._manager.disable();
            this._manager = null;
        }
    }

    _updateIndicator() {
        let show = this._settings.get_boolean('show-indicator');
        if (show) {
            if (!this._indicator) {
                this._indicator = new GnomeletIndicator(this);
                Main.panel.addToStatusArea('gnomelets-indicator', this._indicator);
            }
        } else {
            if (this._indicator) {
                this._indicator.destroy();
                this._indicator = null;
            }
        }
    }
}