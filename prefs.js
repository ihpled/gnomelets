import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DesktopPetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);

        // Pet Count Row
        const countRow = new Adw.ActionRow({ title: 'Number of Pets' });
        const countSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('pet-count', countSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        countRow.add_suffix(countSpin);
        group.add(countRow);

        // Floor Z-Order Row
        const zOrderRow = new Adw.ComboRow({
            title: 'Floor Z-Order',
            model: new Gtk.StringList({
                strings: ['Front (Overlay)', 'Back (Desktop)'],
            }),
        });

        // Map index 0->'front', 1->'back'
        // We need manually bind or use mapped values. 
        // Simple manual sync for clarity:
        if (settings.get_string('floor-z-order') === 'back') {
            zOrderRow.set_selected(1);
        } else {
            zOrderRow.set_selected(0);
        }

        zOrderRow.connect('notify::selected', () => {
            if (zOrderRow.selected === 1) {
                settings.set_string('floor-z-order', 'back');
            } else {
                settings.set_string('floor-z-order', 'front');
            }
        });

        group.add(zOrderRow);

        window.add(page);
    }
}
