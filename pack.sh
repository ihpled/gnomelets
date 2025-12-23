#!/bin/bash

ZIP_NAME="./temp/gnomelets.zip"

# Remove existing zip if it exists
if [ -f "$ZIP_NAME" ]; then
    rm "$ZIP_NAME"
fi

# Zip the extension files
# -r: recurse into directories
# -x: exclude the following patterns
zip -r "$ZIP_NAME" extension.js \
    metadata.json \
    prefs.js \
    schemas/org.gnome.shell.extensions.gnomelets.gschema.xml \
    README.md \
    images/ \
    manager.js \
    gnomelet.js \
    indicator.js \
    utils.js
    

echo "Created $ZIP_NAME"
