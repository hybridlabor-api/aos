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
LAUNCHER_PATH="$DAEMON_LOG_DIR/run_daemon.sh"

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

# 2. Install Python dependency into a dedicated venv.
#
# Two bugs this replaces, both of which made the daemon unable to ever start:
#   1. `pip3 install google-genai` fails on any PEP 668 "externally managed"
#      interpreter (Homebrew/Debian python3) with externally-managed-environment,
#      and the old `2>/dev/null` swallowed that message, so the log said only
#      "pip3 install failed" with no cause.
#   2. Even when it succeeded, it installed into whichever python3 was on PATH
#      (e.g. Homebrew 3.14) while the macOS launcher ran the daemon under
#      /usr/bin/python3 (Apple CommandLineTools 3.9) — a different interpreter
#      that never saw the package.
# A venv fixes both: it is immune to PEP 668, and DAEMON_PYTHON below pins the
# launcher to the exact interpreter the package was installed into.
VENV_DIR="$DAEMON_LOG_DIR/venv"
DAEMON_PYTHON=""

echo "Installing google-genai SDK into $VENV_DIR ..."
mkdir -p "$DAEMON_LOG_DIR"

if command -v uv >/dev/null 2>&1; then
    # uv pip install --python <venv> never needs pip inside the venv, which is
    # the failure memB hit when `uv venv --seed` silently under-delivered pip.
    uv venv "$VENV_DIR" >/dev/null 2>&1 || true
    if [ -x "$VENV_DIR/bin/python" ] && uv pip install --python "$VENV_DIR/bin/python" --quiet google-genai; then
        DAEMON_PYTHON="$VENV_DIR/bin/python"
    fi
fi

if [ -z "$DAEMON_PYTHON" ] && command -v python3 >/dev/null 2>&1; then
    python3 -m venv "$VENV_DIR" >/dev/null 2>&1 || true
    if [ -x "$VENV_DIR/bin/python" ] && "$VENV_DIR/bin/python" -m pip install --quiet google-genai; then
        DAEMON_PYTHON="$VENV_DIR/bin/python"
    fi
fi

if [ -z "$DAEMON_PYTHON" ]; then
    # Do not hide the reason this time — print what actually failed.
    echo "Warning: could not install google-genai into $VENV_DIR."
    echo "         Reason (last attempt):"
    if command -v python3 >/dev/null 2>&1; then
        python3 -m venv "$VENV_DIR" 2>&1 | sed 's/^/           /' | head -5
        "$VENV_DIR/bin/python" -m pip install google-genai 2>&1 | sed 's/^/           /' | head -8
    else
        echo "           python3 not found on PATH."
    fi
    echo "         The daemon will run in collect-only mode until this is resolved."
    # Fall back to a bare interpreter so the launcher is still written; the
    # daemon degrades to collect-only rather than not existing at all.
    DAEMON_PYTHON="$(command -v python3 || echo /usr/bin/python3)"
else
    echo " -> google-genai installed; daemon will run under $DAEMON_PYTHON"
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
    VERIFY_OUTPUT=$("$DAEMON_PYTHON" "$SCRIPTS_DIR/verify_api_key.py" 2>&1)
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

# --- Helpers -------------------------------------------------------------
# POSIX single quoting: wrap in '...' and turn every ' into '\''
sq() {
    printf "'%s'" "${1//\'/\'\\\'\'}"
}

# XML text escaping for the values interpolated into the LaunchAgent plist.
#
# This used to be three ${s//pat/repl} substitutions. Since bash 5.2 an
# unescaped & in the *replacement* stands for the matched text, so on bash 5.3.9
# `${s//</&lt;}` turned a<b into a<lt;b and `${s//>/&gt;}` turned a>b into
# a>gt;b - raw < in the plist, i.e. invalid XML. Only the & case came out right,
# and only because there the bug cancels itself out.
#
# Mapping each character explicitly avoids the replacement-string semantics
# altogether: out+='&amp;' is a plain append, no pattern substitution involved.
# That also removes the ordering question - every input character is looked at
# once, so an inserted entity can never be escaped a second time, on any bash.
xml_escape() {
    local s=$1 out='' i c
    for (( i = 0; i < ${#s}; i++ )); do
        c=${s:i:1}
        case $c in
            '&') out+='&amp;' ;;
            '<') out+='&lt;' ;;
            '>') out+='&gt;' ;;
            *)   out+=$c ;;
        esac
    done
    printf '%s' "$out"
}

# The API key is deliberately NOT written into the LaunchAgent plist or the
# systemd unit. Those are ordinary configuration files (chmod 644 - world
# readable), and `launchctl print` / `systemctl --user cat` hand their contents
# to anything running in the session. The Windows installer solves this with a
# persistent user environment variable that both launchers inherit at logon;
# launchd agents and systemd user units inherit no login shell environment, so
# that route does not exist here. Instead both platforms start a generated
# launcher inside the already private ~/.openwiki directory (mode 700, file
# 700), which exports the key and execs the daemon. The plist and the unit stay
# key-free and may remain 644.
#
# Every value baked into the launcher goes through sq(), so a key or path
# containing quotes, spaces, $ or ; cannot break the script - the previous code
# interpolated $GEMINI_KEY unescaped into XML and into Environment="...".
write_launcher() {
    local python_bin=$1
    local path_value=$2
    # Redirecting onto an existing path follows a symlink and truncates a regular
    # file in place, keeping its old mode - umask 077 only applies to a file that
    # is actually created. An already present 0644 run_daemon.sh therefore held
    # the API key world readable until the chmod 700 below caught up, and a
    # symlink planted there would have taken the key somewhere else entirely.
    # Removing the path first makes the redirect create a fresh file under the
    # umask, with no window in between.
    rm -f "$LAUNCHER_PATH"
    (
        umask 077
        {
            printf '#!/bin/sh\n'
            printf '# Generated by install_daemon.sh - do not edit, re-run the installer.\n'
            printf '# Holds the OpenWiki API key so it stays out of the LaunchAgent plist\n'
            printf '# and the systemd unit. Mode 700 on purpose.\n'
            printf 'HOME=%s; export HOME\n' "$(sq "$HOME")"
            printf 'PATH=%s; export PATH\n' "$(sq "$path_value")"
            if [ -n "$GEMINI_KEY" ]; then
                printf 'GEMINI_API_KEY=%s; export GEMINI_API_KEY\n' "$(sq "$GEMINI_KEY")"
            fi
            printf 'exec %s %s --one-shot\n' "$(sq "$python_bin")" "$(sq "$SCRIPT_PATH")"
        } > "$LAUNCHER_PATH"
    )
    chmod 700 "$LAUNCHER_PATH"
}

mkdir -p "$DAEMON_LOG_DIR"
# The launcher below carries the API key, so the directory must not be world
# readable either.
chmod 700 "$DAEMON_LOG_DIR" 2>/dev/null || true

# 4. Platform-specific daemon registration
if [ "$OS" = "macos" ]; then
    echo "Creating LaunchAgent plist at $PLIST_PATH..."

    # ~/Library/LaunchAgents does not exist on a fresh account. Without this the
    # plist redirect failed with "No such file or directory"; the script has no
    # set -e, so it carried on and `launchctl load` reported the missing agent as
    # the problem - while the launcher with the API key was already on disk.
    # Bailing out here happens before write_launcher, so the key stays off disk.
    # (The systemd branch below already does the same via mkdir -p "$SYSTEMD_DIR".)
    if ! mkdir -p "$(dirname "$PLIST_PATH")"; then
        echo " -> ERROR: could not create $(dirname "$PLIST_PATH")."
        exit 1
    fi

    MACOS_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    write_launcher "$DAEMON_PYTHON" "$MACOS_PATH"
    echo " -> Launcher written to $LAUNCHER_PATH (mode 700; holds the API key, if any)."

    cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bdb.openwiki.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(xml_escape "$LAUNCHER_PATH")</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StartInterval</key>
    <integer>7200</integer>
    <key>StandardOutPath</key>
    <string>$(xml_escape "$DAEMON_LOG_DIR/daemon_stdout.log")</string>
    <key>StandardErrorPath</key>
    <string>$(xml_escape "$DAEMON_LOG_DIR/daemon_stderr.log")</string>
</dict>
</plist>
EOF

    # No secret in here any more, so 644 is fine.
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
        echo "  0 */2 * * *  $DAEMON_PYTHON \"$SCRIPT_PATH\" --one-shot"
        echo ""
        exit 1
    fi

    mkdir -p "$SYSTEMD_DIR"

    LINUX_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    write_launcher "$DAEMON_PYTHON" "$LINUX_PATH"
    echo " -> Launcher written to $LAUNCHER_PATH (mode 700; holds the API key, if any)."

    cat > "$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=OpenWiki Daemon - BDB documentation generator
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$LAUNCHER_PATH
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
    echo "  $DAEMON_PYTHON \"$SCRIPT_PATH\" --one-shot"
    exit 1
fi

echo "========================================================="
