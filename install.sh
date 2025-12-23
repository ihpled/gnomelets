#!/bin/bash

# Configuration
UUID="gnomelets@mcast.gnomext.com"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SOURCE_DIR=$(pwd)
FILES_TO_INSTALL="extension.js prefs.js metadata.json schemas images"
ZIP_MODE=false

# Check for --zip argument
if [[ "$1" == "--zip" ]]; then
    ZIP_MODE=true
fi

echo "🚧 Building and Installing Gnomelets Extension..." // turbo

# 1. Compile Schemas
echo "⚙️ Compiling schemas..."
glib-compile-schemas schemas/

if [ "$ZIP_MODE" = true ]; then
    # Create temp directory
    mkdir -p temp
    ZIP_FILE="temp/${UUID}.zip"

    # Create zip archive
    echo "🤐 Creating zip package: $ZIP_FILE"
    rm -f "$ZIP_FILE"
    zip -r "$ZIP_FILE" $FILES_TO_INSTALL

    echo "✅ Package created successfully!"
else
    # 2. Create directory if it doesn't exist
    if [ ! -d "$INSTALL_DIR" ]; then
        echo "📂 Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    # 3. Copy files
    echo "📦 Copying files to $INSTALL_DIR..."
    cp -r $FILES_TO_INSTALL "$INSTALL_DIR"

    # 4. Success message
    echo "✅ Installation complete!"
    echo "🔄 Please restart GNOME Shell (Alt+F2, then 'r' on X11, or Log Out/In on Wayland) to see changes."
fi
