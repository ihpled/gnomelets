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

        // Gnomelet Character Group
        const charExpander = new Adw.ExpanderRow({
            title: 'Gnomelet Characters',
            subtitle: 'Select which gnomelets to display',
        });
        group.add(charExpander);

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

                // Get currently selected types (array of strings)
                let currentTypes = settings.get_strv('gnomelet-type');
                // Handle case where migration from string might have left it empty or weird, though schema handles default.
                // Let's assume it works or returns default.

                // Ensure we have a set for easier lookup
                let selectedSet = new Set(currentTypes);

                types.forEach(type => {
                    const row = new Adw.ActionRow({ title: type });
                    const check = new Gtk.CheckButton({
                        active: selectedSet.has(type),
                        valign: Gtk.Align.CENTER,
                    });

                    check.connect('toggled', () => {
                        let current = new Set(settings.get_strv('gnomelet-type'));
                        if (check.active) {
                            current.add(type);
                        } else {
                            current.delete(type);
                        }
                        settings.set_strv('gnomelet-type', [...current]);
                    });

                    row.add_suffix(check);
                    charExpander.add_row(row);
                });
            }
        );

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

        // In Front of Maximized (mapped to floor-z-order)
        const zOrderRow = new Adw.ComboRow({
            title: 'In Front of Maximized',
            subtitle: 'Choose behavior regarding maximized windows',
            model: new Gtk.StringList({
                strings: ['Allow (Overlay)', 'Partial (Behind Focused)', 'Disallow (Behind Any)'],
            }),
        });

        // Map config strings to index
        const orderMap = {
            'allow': 0,
            'partial': 1,
            'disallow': 2
        };
        const indexMap = ['allow', 'partial', 'disallow'];

        // Set initial selection
        let currentOrder = settings.get_string('floor-z-order');
        if (orderMap.hasOwnProperty(currentOrder)) {
            zOrderRow.set_selected(orderMap[currentOrder]);
        } else {
            zOrderRow.set_selected(0); // Default allow
        }

        zOrderRow.connect('notify::selected', () => {
            let idx = zOrderRow.selected;
            if (idx >= 0 && idx < indexMap.length) {
                settings.set_string('floor-z-order', indexMap[idx]);
            }
        });

        group.add(zOrderRow);

        // Allow Interaction
        const interactionRow = new Adw.ActionRow({
            title: 'Allow Interaction',
            subtitle: 'Enable dragging gnomelets with the mouse',
        });
        const interactionSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('allow-interaction', interactionSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        interactionRow.add_suffix(interactionSwitch);
        group.add(interactionRow);

        // Show Indicator
        const indicatorRow = new Adw.ActionRow({
            title: 'Show Menu Indicator',
            subtitle: 'Show the gnomelet menu in the top bar',
        });
        const indicatorSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        settings.bind('show-indicator', indicatorSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        indicatorRow.add_suffix(indicatorSwitch);
        group.add(indicatorRow);

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