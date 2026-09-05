#!/usr/bin/env bash
# OpenWiki Upstream Sync & Update Utility for BDB Agent OS
set -e

echo "=== OpenWiki Remote Update Check ==="
CURRENT=$(openwiki --help 2>&1 | grep -q "Usage" && npm list -g --depth=0 openwiki 2>/dev/null | grep openwiki | awk -F@ '{print $2}' || echo "not-installed")
LATEST=$(npm view openwiki version 2>/dev/null || echo "unknown")

echo "Current local version:  $CURRENT"
echo "Latest npm version:     $LATEST"

if [ "$LATEST" = "unknown" ]; then
  echo "Error: Could not reach npm registry to fetch latest openwiki version."
  exit 1
fi

if [ "$CURRENT" != "$LATEST" ]; then
  echo "Updating openwiki from $CURRENT to $LATEST..."
  npm install -g openwiki@latest
  echo "Updating agent integrations..."
  openwiki integrations install claude
  openwiki integrations install opencode
  openwiki integrations install codex
  openwiki integrations install cursor
  echo "=== OpenWiki successfully updated to $LATEST ==="
else
  echo "OpenWiki is already on the latest version ($CURRENT)."
fi
