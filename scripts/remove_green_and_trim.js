const GdkPixbuf = imports.gi.GdkPixbuf;
const GLib = imports.gi.GLib;

let files = ['src/images/mouse.png', 'src/images/santa.png'];
let dir = GLib.get_current_dir();

files.forEach(fname => {
    let f = GLib.build_filenamev([dir, fname]);
    try {
        if (!GLib.file_test(f, GLib.FileTest.EXISTS)) {
            print(`Skipping ${fname}, not found.`);
            return;
        }

        let pixbuf = GdkPixbuf.Pixbuf.new_from_file(f);
        if (!pixbuf.get_has_alpha()) {
            pixbuf = pixbuf.add_alpha(false, 0, 0, 0);
        }

        let w = pixbuf.width;
        let h = pixbuf.height;
        let stride = pixbuf.rowstride;
        let n_channels = pixbuf.n_channels;
        let data = new Uint8Array(pixbuf.get_pixels()); // Copy to Uint8Array for manipulation

        // Green Key Removal (Approximate Green)
        // Target: R=0, G=255, B=0
        // Tolerance: allows near-greens

        let removedCount = 0;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let p = y * stride + x * n_channels;
                let r = data[p];
                let g = data[p + 1];
                let b = data[p + 2];

                // If Green is dominant and bright
                if (g > 100 && r < 100 && b < 100) {
                    data[p + 3] = 0; // Alpha 0
                    removedCount++;
                }
                // Check exact green 00FF00
                else if (g > 200 && r < 50 && b < 50) {
                    data[p + 3] = 0;
                    removedCount++;
                }
            }
        }
        print(`Removed green background from ${fname} (${removedCount} pixels).`);

        // Reconstruct from modified data to reuse trim logic?
        // Let's do trim logic directly on `data` if we can find bounds.

        // Find bounds on 'data'
        let top = 0;
        outerTop:
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let p = y * stride + x * n_channels;
                if (data[p + 3] > 0) {
                    top = y;
                    break outerTop;
                }
            }
        }

        let bottom = h;
        outerBottom:
        for (let y = h - 1; y >= 0; y--) {
            for (let x = 0; x < w; x++) {
                let p = y * stride + x * n_channels;
                if (data[p + 3] > 0) {
                    bottom = y + 1;
                    break outerBottom;
                }
            }
        }

        let newH = bottom - top;
        if (newH < 1) newH = 1;

        // Construct new Pixbuf
        let bytes = GLib.Bytes.new(data);
        let tempPixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            bytes,
            GdkPixbuf.Colorspace.RGB,
            true, 8, w, h, stride
        );

        if (newH < h) {
            let finalPixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, w, newH);
            tempPixbuf.copy_area(0, top, w, newH, finalPixbuf, 0, 0);
            finalPixbuf.savev(f, "png", [], []);
            print(`Trimmed ${fname}: ${w}x${h} -> ${w}x${newH}`);
        } else {
            // Just save the green-removed version
            tempPixbuf.savev(f, "png", [], []);
            print(`Saved ${fname} (no trim needed).`);
        }

    } catch (e) {
        print(`Error processing ${fname}: ${e}`);
        print(e.stack);
    }
});
