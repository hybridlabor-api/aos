#!/bin/bash

# Ensure directories exist
mkdir -p ~/.openwiki ~/.gemini ~/.MemBDB

# Ensure files exist
touch ~/.openwiki/daemon.log ~/.gemini/token-saver.log ~/.MemBDB/memb.log

echo -e "\033[1;37mStarting Unified Ecosystem Debugger (Press Ctrl+C to exit)\033[0m"
echo -e "\033[36mCyan: OpenWiki\033[0m | \033[32mGreen: TokenSaver\033[0m | \033[33mYellow: MemB\033[0m"
echo "--------------------------------------------------------------------------------"

# Tail files in the background and colorize output
tail -f ~/.openwiki/daemon.log | awk '{print "\033[36m[OpenWiki]\033[0m " $0}' &
tail -f ~/.gemini/token-saver.log | awk '{print "\033[32m[TokenSaver]\033[0m " $0}' &
tail -f ~/.MemBDB/memb.log | awk '{print "\033[33m[MemB]\033[0m " $0}' &

# Wait for background jobs to finish (which they won't until killed)
wait
