#!/bin/bash
# OpenWiki Background Daemon installer
#   macOS: LaunchAgent (StartInterval 2h)
#   Linux: systemd user service + timer (if available)
#   other / no systemd: clear skip, never a false success

set -u

PLIST_PATH="$HOME/Library/LaunchAgents/com.bdb.openwiki.daemon.plist"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SYSTEMD_SERVICE="$SYSTEMD_DIR/openwiki-daemon.service"
SYSTEMD_TIMER="$SYSTEMD_DIR/openwiki-daemon.timer"
SCRIPT_PATH="$HOME/.gemini/config/skills/openwiki-skill/scripts/openwiki_daemon.py"
DAEMON_LOG_DIR="$HOME/.openwiki"

detect_os() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux) echo "linux" ;;
        *) echo "unknown" ;;
    esac
}

echo "========================================================="
echo " Installing OpenWiki Background Daemon"
echo " Using Gemma 4 Direct API (no agy spawning)"
echo "========================================================="

OS="$(detect_os)"

# 1. Resolve script path
if [ ! -f "$SCRIPT_PATH" ]; then
    SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/openwiki_daemon.py"
    if [ ! -f "$SCRIPT_PATH" ]; then
        echo "Error: Cannot find openwiki_daemon.py"
        exit 1
    fi
fi
SCRIPTS_DIR="$(dirname "$SCRIPT_PATH")"

# 2. Install Python dependency
echo "Installing google-genai SDK..."
if command -v pip3 >/dev/null 2>&1; then
    pip3 install --quiet google-genai 2>/dev/null || {
        echo "Warning: pip3 install failed. You may need to install google-genai manually."
    }
else
    echo "Warning: pip3 not found. Install google-genai manually."
fi

# 3. Resolve API key
GEMINI_KEY="${GEMINI_API_KEY:-}"
if [ -z "$GEMINI_KEY" ]; then
    echo ""
    echo "GEMINI_API_KEY is not set in your environment."
    read -rp "Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
fi

if [ -n "$GEMINI_KEY" ]; then
    export GEMINI_API_KEY="$GEMINI_KEY"
    echo "Verifying API key..."
    VERIFY_OUTPUT=$(python3 "$SCRIPTS_DIR/verify_api_key.py" 2>&1)
    VERIFY_CODE=$?
    if [ $VERIFY_CODE -eq 0 ] && echo "$VERIFY_OUTPUT" | grep -q "VERIFIED_OK"; then
        echo " -> API key verified successfully."
    else
        echo " -> WARNING: API key verification failed (with retry + TLS fallback)."
        echo "$VERIFY_OUTPUT" | sed 's/^/    /'
        echo "    The daemon will run in collect-only mode until a valid key is set."
        GEMINI_KEY=""
    fi
else
    echo "No API key provided. Daemon will run in collect-only mode."
fi

mkdir -p "$DAEMON_LOG_DIR"

# 4. Platform-specific daemon registration
if [ "$OS" = "macos" ]; then
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

    launchctl unload "$PLIST_PATH" 2>/dev/null
    echo "Loading LaunchAgent..."
    launchctl load "$PLIST_PATH"

    sleep 1
    if launchctl list | grep "com.bdb.openwiki.daemon" > /dev/null; then
        echo " -> Success! OpenWiki daemon installed (runs every 2 hours via StartInterval)."
        echo " -> Logs: $DAEMON_LOG_DIR/daemon.log"
        echo " -> Projects config: $DAEMON_LOG_DIR/projects.json"
    else
        echo " -> ERROR: LaunchAgent not loaded after install."
        exit 1
    fi
elif [ "$OS" = "linux" ]; then
    if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user list-units --type=timer >/dev/null 2>&1; then
        echo ""
        echo "Linux detected, but no usable systemd user session was found."
        echo "Skipping automatic daemon installation (no false success)."
        echo "Run it manually instead, e.g. via cron (every 2 hours):"
        echo "  0 */2 * * *  python3 \"$SCRIPT_PATH\" --one-shot"
        echo ""
        exit 1
    fi

    mkdir -p "$SYSTEMD_DIR"

    ENV_BLOCK="Environment=\"HOME=$HOME\"
Environment=\"PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\""
    if [ -n "$GEMINI_KEY" ]; then
        ENV_BLOCK="$ENV_BLOCK
Environment=\"GEMINI_API_KEY=$GEMINI_KEY\""
    fi

    cat > "$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=OpenWiki Daemon - BDB documentation generator
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env python3 "$SCRIPT_PATH" --one-shot
$ENV_BLOCK
StandardOutput=append:$DAEMON_LOG_DIR/daemon_stdout.log
StandardError=append:$DAEMON_LOG_DIR/daemon_stderr.log

[Install]
WantedBy=default.target
EOF

    cat > "$SYSTEMD_TIMER" <<EOF
[Unit]
Description=Run OpenWiki Daemon every 2 hours

[Timer]
OnBootSec=5min
OnUnitActiveSec=2h
Unit=openwiki-daemon.service

[Install]
WantedBy=timers.target
EOF

    chmod 644 "$SYSTEMD_SERVICE" "$SYSTEMD_TIMER"

    systemctl --user daemon-reload
    systemctl --user enable --now openwiki-daemon.timer
    systemctl --user start openwiki-daemon.timer

    sleep 1
    if systemctl --user is-active --quiet openwiki-daemon.timer; then
        echo " -> Success! OpenWiki daemon installed as a systemd user service (runs every 2 hours)."
        echo " -> Logs: $DAEMON_LOG_DIR/daemon.log"
        echo " -> Projects config: $DAEMON_LOG_DIR/projects.json"
    else
        echo " -> ERROR: systemd timer did not start."
        exit 1
    fi
else
    echo "Unsupported OS: $OS"
    echo "Skipping automatic daemon installation (no false success)."
    echo "Run it manually via cron / task scheduler:"
    echo "  python3 \"$SCRIPT_PATH\" --one-shot"
    exit 1
fi

echo "========================================================="
