import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DesktopGnomeletsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);

        // Gnomelet Character Row
        const typeRow = new Adw.ComboRow({
            title: 'Gnomelet Character',
            model: new Gtk.StringList({ strings: ['Loading...'] }),
        });
        typeRow.set_sensitive(false);

        // Dynamic listing of gnomelet types
        const file = Gio.File.new_for_uri(import.meta.url);
        const imagesDir = file.get_parent().get_child('images');

        imagesDir.enumerate_children_async(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (obj, res) => {
                let types = [];
                try {
                    let enumerator = obj.enumerate_children_finish(res);
                    let info;
                    while ((info = enumerator.next_file(null))) {
                        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                            types.push(info.get_name());
                        }
                    }
                } catch (e) {
                    console.error('Failed to list gnomelet types:', e);
                }

                types.sort();
                if (types.length === 0) types.push('Santa');

                typeRow.model = new Gtk.StringList({ strings: types });
                typeRow.set_sensitive(true);

                const currentType = settings.get_string('gnomelet-type');
                let initialIndex = types.indexOf(currentType);

                // Set the selected index to the current type, or the first type if not found
                typeRow.set_selected(initialIndex >= 0 ? initialIndex : 0);
            }
        );

        typeRow.connect('notify::selected', () => {
            if (!typeRow.sensitive) return;
            const selectedType = typeRow.model.get_string(typeRow.selected);
            if (selectedType && selectedType !== 'Loading...') {
                settings.set_string('gnomelet-type', selectedType);
            }
        });
        group.add(typeRow);

        // Gnomelet Count Row
        const countRow = new Adw.ActionRow({ title: 'Number of Gnomelets' });
        const countSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 20,
                step_increment: 1,
            }),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('gnomelet-count', countSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
        countRow.add_suffix(countSpin);
        group.add(countRow);

        // Gnomelet Scale Row
        const scaleRow = new Adw.ActionRow({ title: 'Gnomelet Size (px)' });
        const scaleSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 32,
                upper: 256,
                step_increment: 8,
            }),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('gnomelet-scale', scaleSpin, 'value', Gio.SettingsBindFlags.DEFAULT);
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
            label: 'Respawn Gnomelets',
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
