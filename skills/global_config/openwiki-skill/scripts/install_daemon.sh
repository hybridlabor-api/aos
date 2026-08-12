#!/bin/bash

PLIST_PATH="$HOME/Library/LaunchAgents/com.bdb.openwiki.daemon.plist"
SCRIPT_PATH="$HOME/.gemini/config/skills/openwiki-skill/scripts/openwiki_daemon.py"
DAEMON_LOG_DIR="$HOME/.openwiki"

echo "========================================================="
echo " Installing OpenWiki Background Daemon (macOS LaunchAgent)"
echo " Using Gemma 4 Direct API (no agy spawning)"
echo "========================================================="

# 1. Resolve script path
if [ ! -f "$SCRIPT_PATH" ]; then
    SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/openwiki_daemon.py"
    if [ ! -f "$SCRIPT_PATH" ]; then
        echo "Error: Cannot find openwiki_daemon.py"
        exit 1
    fi
fi

# 2. Install Python dependency
echo "Installing google-genai SDK..."
pip3 install --quiet google-genai 2>/dev/null || {
    echo "Warning: pip3 install failed. You may need to install google-genai manually."
}

# 3. Resolve API key
GEMINI_KEY="${GEMINI_API_KEY:-}"
if [ -z "$GEMINI_KEY" ]; then
    echo ""
    echo "GEMINI_API_KEY is not set in your environment."
    read -rp "Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
fi

if [ -n "$GEMINI_KEY" ]; then
    echo "Verifying API key..."
    VERIFY_MODEL="${OPENWIKI_MODEL:-gemma-4-12b-it}"
    VERIFY_RESULT=$(python3 -c "
from google import genai
client = genai.Client(api_key='$GEMINI_KEY')
r = client.models.generate_content(model='$VERIFY_MODEL', contents='Say OK')
print('OK')
" 2>&1)
    if echo "$VERIFY_RESULT" | grep -q "OK"; then
        echo " -> API key verified successfully."
    else
        echo " -> WARNING: API key verification failed: $VERIFY_RESULT"
        echo "    The daemon will run in collect-only mode until a valid key is set."
        GEMINI_KEY=""
    fi
else
    echo "No API key provided. Daemon will run in collect-only mode."
fi

mkdir -p "$DAEMON_LOG_DIR"

# 4. Write plist
echo "Creating LaunchAgent plist at $PLIST_PATH..."

GEMINI_KEY_BLOCK=""
if [ -n "$GEMINI_KEY" ]; then
    GEMINI_KEY_BLOCK="        <key>GEMINI_API_KEY</key>
        <string>$GEMINI_KEY</string>"
fi

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.openwiki.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$SCRIPT_PATH</string>
        <string>--one-shot</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
$GEMINI_KEY_BLOCK
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StartInterval</key>
    <integer>7200</integer>
    <key>StandardOutPath</key>
    <string>$DAEMON_LOG_DIR/daemon_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$DAEMON_LOG_DIR/daemon_stderr.log</string>
</dict>
</plist>
EOF

chmod 644 "$PLIST_PATH"

# 5. Reload agent
launchctl unload "$PLIST_PATH" 2>/dev/null
echo "Loading LaunchAgent..."
launchctl load "$PLIST_PATH"

# 6. Verify
sleep 1
if launchctl list | grep "com.bdb.openwiki.daemon" > /dev/null; then
    echo " -> Success! OpenWiki daemon installed (runs every 2 hours via StartInterval)."
    echo " -> Logs: $DAEMON_LOG_DIR/daemon.log"
    echo " -> Projects config: $DAEMON_LOG_DIR/projects.json"
fi
echo "========================================================="
