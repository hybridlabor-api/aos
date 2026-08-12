import pty, os, sys, shutil, time

node_path = shutil.which('node')
pid, fd = pty.fork()

if pid == 0:
    os.execv(node_path, ['node', 'installer.js'])
else:
    def read_until(pattern, timeout=5):
        buffer = ""
        start = time.time()
        while time.time() - start < timeout:
            try:
                char = os.read(fd, 1).decode('utf-8', errors='ignore')
                buffer += char
                sys.stdout.write(char)
                sys.stdout.flush()
                if pattern in buffer:
                    return buffer
            except BlockingIOError:
                time.sleep(0.1)
            except OSError:
                break
        return buffer

    os.set_blocking(fd, False)

    read_until("Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.")
    os.write(fd, b"\r")
    time.sleep(0.5)

    read_until("Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.")
    os.write(fd, b"\r")
    time.sleep(0.5)

    read_until("Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.")
    os.write(fd, b"\r")
    time.sleep(0.5)

    # MCP Menu - a to select all, a to deselect all, enter
    read_until("Use UP/DOWN arrows to navigate, SPACE to toggle, 'a' to select all, ENTER to confirm.")
    os.write(fd, b"aa\r")
    time.sleep(0.5)

    # OpenWiki Provider
    read_until("Choose OpenWiki LLM Provider:")
    read_until("Use UP/DOWN arrows to navigate, SPACE to select, ENTER to confirm.")
    os.write(fd, b"\r")
    time.sleep(0.5)
    
    read_until("Model name")
    os.write(fd, b"\r")
    time.sleep(0.5)

    read_until("GEMINI_API_KEY")
    os.write(fd, b"\r")
    time.sleep(0.5)

    read_until("GITHUB_PERSONAL_ACCESS_TOKEN")
    os.write(fd, b"\r")
    time.sleep(0.5)

    # Creator Extension
    read_until("Install 'BDB Creator Extension'")
    time.sleep(0.5)
    os.write(fd, b"j \r") # down arrow, space, enter
    time.sleep(0.5)

    # OS Agent
    read_until("Install 'BDB OS Agent Workspace'")
    time.sleep(0.5)
    os.write(fd, b"j \r")
    time.sleep(0.5)

    # memB
    read_until("Would you like to scan & ingest")
    time.sleep(0.5)
    os.write(fd, b"j \r")
    time.sleep(0.5)

    read_until("Installation complete")
    time.sleep(2)
