#!/bin/bash

ZIP_NAME="./temp/gnomelets.zip"

# Remove existing zip if it exists
if [ -f "$ZIP_NAME" ]; then
    rm "$ZIP_NAME"
fi

# Zip the extension files
# -r: recurse into directories
# -x: exclude the following patterns
zip -r "$ZIP_NAME" . \
    -x "*.git*" \
    -x ".gitignore" \
    -x "schemas/gschemas.compiled" \
    -x "install.sh" \
    -x "pack.sh" \
    -x "remove_green_and_trim.js" \
    -x "temp/*" \
    -x "*~" \
    -x "*.vscode*"

echo "Created $ZIP_NAME"
