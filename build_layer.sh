#!/bin/bash

set -ex  # print commands and exit on errors

LAYER_NAME="shared-deps"
LAYER_DIR="layers/$LAYER_NAME"
NODEJS_DIR="$LAYER_DIR/nodejs"
ZIP_FILE="$LAYER_NAME-layer.zip"

echo "🔄 Cleaning previous build..."
rm -rf "$LAYER_DIR" "$ZIP_FILE"

echo "📁 Creating full directory structure..."
mkdir -p "$NODEJS_DIR"

echo "📦 Copying node_modules and package.json into layer..."
cp -r node_modules "$NODEJS_DIR/"
cp package.json "$NODEJS_DIR/"

echo "🗜️  Creating layer zip file: $ZIP_FILE..."
cd "$LAYER_DIR"
zip -r "../../$ZIP_FILE" nodejs
cd -

echo "✅ Layer built: $ZIP_FILE"
