#!/bin/bash

# Configuration
UUID="desktop-pets@mcast.gnomext.com"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCE_DIR=$(pwd)

echo "🚧 Building and Installing Desktop Pets Extension..." // turbo

# 1. Compile Schemas
echo "⚙️ Compiling schemas..."
glib-compile-schemas schemas/

# 2. Create directory if it doesn't exist
if [ ! -d "$INSTALL_DIR" ]; then
    echo "📂 Creating install directory: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
fi

# 3. Copy files
echo "📦 Copying files to $INSTALL_DIR..."
cp -r extension.js prefs.js metadata.json stylesheet.css schemas images "$INSTALL_DIR"

# 4. Success message
echo "✅ Installation complete!"
echo "🔄 Please restart GNOME Shell (Alt+F2, then 'r' on X11, or Log Out/In on Wayland) to see changes."
