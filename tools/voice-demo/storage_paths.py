"""Recognize Linux bind mounts, which os.path.ismount may miss on one filesystem."""
from pathlib import Path

def archive_mounted():
    try:
        return any(len(parts)>4 and parts[4]=='/data' for parts in
            (line.split() for line in Path('/proc/self/mountinfo').read_text().splitlines()))
    except OSError:
        return False
