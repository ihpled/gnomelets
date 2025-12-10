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

        // Pet Character Row
        const typeRow = new Adw.ComboRow({
            title: 'Pet Character',
            model: new Gtk.StringList({
                strings: ['Kitten', 'Puppy', 'Mouse', 'Squirrel', 'Santa Claus'],
            }),
        });

        const typeMap = ['kitten', 'puppy', 'mouse', 'squirrel', 'santa'];
        const currentType = settings.get_string('pet-type');
        const initialIndex = typeMap.indexOf(currentType);
        typeRow.set_selected(initialIndex >= 0 ? initialIndex : 0);

        typeRow.connect('notify::selected', () => {
            const selectedType = typeMap[typeRow.selected];
            settings.set_string('pet-type', selectedType);
        });
        group.add(typeRow);

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

        // Pet Scale Row
        const scaleRow = new Adw.ActionRow({ title: 'Pet Size (px)' });
        const scaleSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 32,
                upper: 256,
                step_increment: 8,
            }),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('pet-scale', scaleSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        scaleRow.add_suffix(scaleSpin);
        group.add(scaleRow);

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

        // Actions Group
        const actionsGroup = new Adw.PreferencesGroup({ title: 'Actions' });
        page.add(actionsGroup);

        const respawnRow = new Adw.ActionRow({ title: 'Reset State' });
        const respawnButton = new Gtk.Button({
            label: 'Respawn Pets',
            valign: Gtk.Align.CENTER,
        });

        respawnButton.connect('clicked', () => {
            // Toggle the boolean value to trigger a change signal
            let current = settings.get_boolean('reset-trigger');
            settings.set_boolean('reset-trigger', !current);
        });

        respawnRow.add_suffix(respawnButton);
        actionsGroup.add(respawnRow);

        window.add(page);
    }
}
