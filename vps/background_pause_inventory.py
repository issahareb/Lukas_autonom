"""Read-only, secret-free inventory for an explicitly requested Lukas pause."""
import json, os, pathlib, re, shlex, subprocess, signal
BASE = pathlib.Path("/root/Agent-spy")
SCRIPTS = {"loop.py", "agent.py", "patcher.py", "dream.py", "lukas_brain.py",
           "telegram_bot.py", "bug_reasoner.py", "loss_reasoner.py",
           "reddit_polymarket_watcher.py", "self_heal_daemon.py", "run.sh", "run_loop.sh"}
KNOWN = {"lukas-brain.service": "lukas_brain.py", "lukas-telegram.service": "telegram_bot.py",
         "lukas-bug-reasoner.service": "bug_reasoner.py", "lukas-loss-reasoner.service": "loss_reasoner.py",
         "lukas-reddit-watcher.service": "reddit_polymarket_watcher.py",
         "lukas-self-heal.service": "self_heal_daemon.py"}
TRADING = ["lukas-bot.service", "lukas-btc-trader.service", "lukas-btc-paper-trader.service",
           "lukas-manual-sell-watcher.service", "postgresql.service", "lukas-vpn.service"]
result = {"mode": "inventory", "paused": False, "ok": False, "root": os.geteuid() == 0,
          "base_exists": BASE.is_dir(), "units": [], "protected_units": [], "timers": [],
          "processes": {}, "other_path_processes": 0, "cron": [], "errors": []}
def run(args, timeout=5):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except Exception:
        result["errors"].append("inventory_command_failed")
        return -1, ""
def unit(name):
    code, text = run(["systemctl", "show", name, "--no-pager",
        "-p", "LoadState", "-p", "ActiveState", "-p", "UnitFileState",
        "-p", "WorkingDirectory", "-p", "ExecStart", "-p", "Triggers"])
    props = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    if not props.get("LoadState"): result["errors"].append("unit_inventory_failed")
    return props
def expected_script(props, expected=None):
    match = re.search(r"argv\[\]=(.*?)\s*;", props.get("ExecStart", ""))
    if not match: return None
    try: args = shlex.split(match.group(1))
    except ValueError: return None
    if not args or not re.fullmatch(r"python(?:3(?:\.\d+)?)?|bash|sh", pathlib.Path(args[0]).name): return None
    args = args[1:]
    while args and args[0] in ("-u", "-B", "-I", "-E", "-s"): args = args[1:]
    if not args or args[0].startswith("-"): return None
    if props.get("WorkingDirectory", "") != str(BASE): return None
    path = pathlib.Path(args[0])
    path = path if path.is_absolute() else BASE / path
    try: path = path.resolve(strict=True)
    except OSError: return None
    if path.parent != BASE or path.name not in SCRIPTS: return None
    return path.name if expected is None or path.name == expected else None
try:
    signal.alarm(70)
    for name, script in KNOWN.items():
        p = unit(name)
        result["units"].append({"name": name, "load": p.get("LoadState", "unknown"),
            "active": p.get("ActiveState", "unknown"), "enabled": p.get("UnitFileState", "unknown"),
            "expected_script": expected_script(p, script) is not None})
    for name in TRADING:
        p = unit(name)
        result["protected_units"].append({"name": name, "active": p.get("ActiveState", "unknown")})
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid(): continue
        try:
            args = [x.decode(errors="replace") for x in (entry / "cmdline").read_bytes().split(b"\0") if x]
            if not args or not re.fullmatch(r"python(?:3(?:\.\d+)?)?|bash|sh", pathlib.Path(args[0]).name): continue
            args = args[1:]
            while args and args[0] in ("-u", "-B", "-I", "-E", "-s"): args = args[1:]
            if not args or args[0].startswith("-") or pathlib.Path(args[0]).name not in SCRIPTS: continue
            cwd = (entry / "cwd").resolve(strict=True)
            script = pathlib.Path(args[0])
            script = (script if script.is_absolute() else cwd / script).resolve(strict=True)
            if script.parent == BASE and (cwd == BASE or BASE in cwd.parents):
                result["processes"][script.name] = result["processes"].get(script.name, 0) + 1
            else: result["other_path_processes"] += 1
        except (OSError, ValueError): continue
    code, text = run(["systemctl", "list-unit-files", "--type=timer", "--no-legend", "--no-pager"])
    if code != 0: result["errors"].append("timer_inventory_failed")
    timers = [line.split()[0] for line in text.splitlines() if line.split()]
    for name in timers[:64]:
        if not re.fullmatch(r"[A-Za-z0-9_.@-]+\.timer", name): continue
        p = unit(name)
        for target in p.get("Triggers", "").split():
            if not re.fullmatch(r"[A-Za-z0-9_.@-]+\.service", target): continue
            script = expected_script(unit(target))
            if target in KNOWN or script:
                result["timers"].append({"name": name, "service": target,
                    "active": p.get("ActiveState", "unknown"), "expected_script": script is not None})
    if len(timers) > 64: result["errors"].append("timer_inventory_incomplete")
    sources, users = [], {"root"}
    for spool in ("/var/spool/cron/crontabs", "/var/spool/cron"):
        directory = pathlib.Path(spool)
        if directory.is_dir():
            for f in directory.iterdir():
                if f.is_file() and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", f.name): users.add(f.name)
    for user in sorted(users):
        code, text = run(["crontab", "-u", user, "-l"])
        if code == 0: sources.append(("user_crontab", text))
        elif code != 1: result["errors"].append("crontab_inventory_failed")
    for f in [pathlib.Path("/etc/crontab"), *pathlib.Path("/etc/cron.d").glob("*")]:
        if f.is_file():
            if f.stat().st_size > 262144: result["errors"].append("cron_file_too_large"); continue
            sources.append(("system_cron", f.read_text(errors="replace")))
    pattern = re.compile(r"(?<![A-Za-z0-9_.-])(" + "|".join(re.escape(s) for s in SCRIPTS | {"start_lukas.sh", "start_all.sh"}) + r")(?![A-Za-z0-9_.-])")
    for source_kind, text in sources:
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"): continue
            targets = sorted(set(pattern.findall(line)))
            if targets:
                result["cron"].append({"source": source_kind, "scripts": targets,
                    "root_path_explicit": str(BASE) in line, "mixed_trading_reference":
                        "Polymarket_bot" in line or "btc_15m_" in line or "start_all.sh" in line})
    for directory in ("/etc/cron.hourly", "/etc/cron.daily", "/etc/cron.weekly", "/etc/cron.monthly"):
        for f in pathlib.Path(directory).glob("*"):
            if not f.is_file() or not os.access(f, os.X_OK): continue
            if f.stat().st_size > 262144: result["errors"].append("periodic_file_too_large"); continue
            targets = sorted(set(pattern.findall(f.read_text(errors="replace"))))
            if targets: result["cron"].append({"source": "periodic_script", "scripts": targets, "needs_review": True})
    result["ok"] = not result["errors"]
except Exception:
    result["errors"].append("inventory_failed")
print(json.dumps(result, separators=(",", ":")))
raise SystemExit(0 if result["ok"] else 1)
