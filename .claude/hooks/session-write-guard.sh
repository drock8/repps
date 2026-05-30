#!/bin/bash
# Session write guard hook — PreToolUse on Bash and Write
# Blocks direct writes to MCP-owned files in ~/bounty-agent-sessions/
# Forces agents to use MCP tools for structured output
# Exit 0 = allow, Exit 2 = block

INPUT=$(cat)
export WRITE_GUARD_INPUT="$INPUT"

python3 - <<'PY'
import json
import os
import pathlib
import re
import sys


SESSIONS_ROOT = pathlib.Path.home() / "bounty-agent-sessions"

# Files that MUST be written through MCP tools only
MCP_OWNED_EXACT = {
    "state.json",
    "coverage.jsonl",
    "technique-attempts.jsonl",
    "technique-pack-reads.jsonl",
    "chain-attempts.jsonl",
    "findings.jsonl",
    "findings.md",
    "brutalist.json",
    "brutalist.md",
    "balanced.json",
    "balanced.md",
    "verified-final.json",
    "verified-final.md",
    "evidence-packs.json",
    "evidence-packs.md",
    "grade.json",
    "grade.md",
    "SESSION_HANDOFF.md",
    "auth.json",
    "http-audit.jsonl",
    "traffic.jsonl",
    "public-intel.json",
    "Dockerfile.bob",
    "repo-checks.jsonl",
    "repo-command-runs.jsonl",
    "repo-env.json",
    "repo-inventory.json",
    "surface-routes.json",
    "static-artifacts.jsonl",
    "static-scan-results.jsonl",
    "pipeline-events.jsonl",
}

MCP_OWNED_DIRS = {
    "static-imports",
}

MCP_OWNED_PATTERNS = [
    re.compile(r"^handoff-w\d+-a\d+\.(json|md)$"),
    re.compile(r"^wave-\d+-assignments\.json$"),
    re.compile(r"^live-dead-ends-w\d+-a\d+\.jsonl$"),
]

# Files that agents are allowed to write directly. JSON entries here are
# compact recon/report artifacts; bulky raw captures remain blocked by name on
# the read side and should not be written as ad hoc session files.
AGENT_ALLOWED_EXACT = {
    "chains.md",
    "report.md",
    "attack_surface.json",
    "deep-summary.json",
    "recon-summary.json",
    "scope-warnings.log",
    "deny-list.txt",
}

AGENT_ALLOWED_PATTERNS = [
    re.compile(r"^.*\.txt$"),
]


def is_mcp_owned(filename):
    if filename in MCP_OWNED_EXACT:
        return True
    return any(p.match(filename) for p in MCP_OWNED_PATTERNS)


def is_agent_allowed(filename):
    if filename in AGENT_ALLOWED_EXACT:
        return True
    return any(p.match(filename) for p in AGENT_ALLOWED_PATTERNS)


def resolve_path(raw_path):
    path_text = raw_path.strip().strip("\"'")

    env_session = os.environ.get("SESSION", "")
    if env_session:
        path_text = path_text.replace("${SESSION}", env_session).replace("$SESSION", env_session)

    home = str(pathlib.Path.home())
    path_text = path_text.replace("${HOME}", home).replace("$HOME", home)

    if path_text.startswith("~"):
        path_text = os.path.expanduser(path_text)

    return pathlib.Path(path_text)


def is_in_session_dir(resolved):
    try:
        resolved.resolve(strict=False).relative_to(SESSIONS_ROOT.resolve(strict=False))
        return True
    except (ValueError, OSError):
        return False


def check_file(raw_path):
    """Returns filename to block, or None to allow."""
    resolved = resolve_path(raw_path)

    if not is_in_session_dir(resolved):
        return None

    filename = resolved.name

    if any(part in MCP_OWNED_DIRS for part in resolved.parts):
        return filename

    if is_agent_allowed(filename):
        return None

    if is_mcp_owned(filename):
        return filename

    # Block by default for unrecognized files in session dir
    return filename


def block(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


def extract_redirect_targets(command):
    """Extract file paths from shell redirect operators and tee commands."""
    targets = []

    # Match > and >> redirects (skip heredocs like <<EOF and <<'EOF')
    for match in re.finditer(r"(?<!<)>{1,2}\s*[\"']?([^\"'\s|;&)\n]+)", command):
        target = match.group(1)
        # Skip process substitution and fd redirects
        if target.startswith("(") or target.startswith("&") or target == "/dev/null":
            continue
        targets.append(target)

    # Match tee targets: tee [-a] filepath
    for match in re.finditer(r"\btee\s+(?:-[a]\s+)?[\"']?([^\"'\s|;&)\n]+)", command):
        target = match.group(1)
        if not target.startswith("-"):
            targets.append(target)

    return targets


def extract_inline_script_paths(command):
    """Extract file paths from python3/node/ruby/perl inline scripts that write files."""
    targets = []

    # Instead of parsing quoting contexts, scan the entire command for file-write
    # patterns when an interpreter is present. This catches:
    #   python3 -c "open('/path','w').write(...)"
    #   python3 - <<'PY' ... open('/path','w') ... PY
    #   python3 -c "Path('/path').write_text(...)"
    # Regardless of quote escaping or heredoc boundaries.

    # open("/path", ...) or open('/path', ...)
    for match in re.finditer(r"""open\s*\(\s*["']([^"']+)["']""", command):
        targets.append(match.group(1))

    # pathlib.Path("/path").write_text(...) or Path('/path').write_text(...)
    for match in re.finditer(r"""Path\s*\(\s*["']([^"']+)["']\s*\)\s*\.write""", command):
        targets.append(match.group(1))

    return targets


def extract_file_command_targets(command):
    """Extract destination paths from cp, mv, ln, dd, install, rsync commands."""
    targets = []

    # cp/mv/install/rsync: last non-flag argument is the destination
    for match in re.finditer(r"\b(cp|mv|install|rsync)\b(.*?)(?:[;&|]|$)", command):
        args = match.group(2).strip()
        # Split on whitespace, skip flags (starting with -)
        parts = [p.strip("\"'") for p in args.split() if not p.startswith("-")]
        if len(parts) >= 2:
            targets.append(parts[-1])

    # ln [-sfn...] target link_name — destination is last arg
    for match in re.finditer(r"\bln\b(.*?)(?:[;&|]|$)", command):
        args = match.group(1).strip()
        parts = [p.strip("\"'") for p in args.split() if not p.startswith("-")]
        if len(parts) >= 2:
            targets.append(parts[-1])

    # dd of=<path>
    for match in re.finditer(r"\bdd\b.*?\bof=\s*[\"']?([^\"'\s;&|]+)", command):
        targets.append(match.group(1))

    return targets


def extract_write_api_targets(command):
    """Extract file paths from writeFileSync/writeFile/appendFileSync and similar APIs."""
    targets = []

    # writeFileSync("path", ...) / writeFile("path", ...) / appendFileSync("path", ...)
    for match in re.finditer(r"(?:writeFileSync|writeFile|appendFileSync)\s*\(\s*[\"']([^\"']+)[\"']", command):
        targets.append(match.group(1))

    # File.write("path", ...) / IO.write("path", ...)
    for match in re.finditer(r"(?:File|IO)\.write\s*\(\s*[\"']([^\"']+)[\"']", command):
        targets.append(match.group(1))

    return targets


# Main
payload = {}
try:
    payload = json.loads(os.environ.get("WRITE_GUARD_INPUT", ""))
except Exception:
    payload = {}

tool_input = payload.get("tool_input", {})

# Detect Write tool vs Bash tool
if "file_path" in tool_input:
    # Write tool
    blocked = check_file(tool_input["file_path"])
    if blocked:
        block(
            f"BLOCKED: Direct write to '{blocked}' in session directory. "
            f"Use the appropriate bountyagent MCP tool instead."
        )
    raise SystemExit(0)

# Bash tool
command = tool_input.get("command", "")
if not command:
    raise SystemExit(0)

# Quick gate: skip if no write indicators
has_redirects = re.search(r">{1,2}\s|tee\s", command)
has_open_call = re.search(r"open\s*\(|Path\s*\(", command)
has_file_commands = re.search(r"\b(cp|mv|ln|dd|install|rsync)\b", command)
has_write_api = re.search(r"writeFileSync|writeFile|appendFileSync|File\.write|IO\.write", command)

if not has_redirects and not has_open_call and not has_file_commands and not has_write_api:
    raise SystemExit(0)

# Extract and check redirect targets
if has_redirects:
    for target in extract_redirect_targets(command):
        blocked = check_file(target)
        if blocked:
            block(
                f"BLOCKED: Bash redirect to '{blocked}' in session directory. "
                f"Use the appropriate bountyagent MCP tool instead."
            )

# Extract and check inline script file writes (open(), Path().write_text(), etc.)
if has_open_call:
    for target in extract_inline_script_paths(command):
        blocked = check_file(target)
        if blocked:
            block(
                f"BLOCKED: Inline script writes to '{blocked}' in session directory. "
                f"Use the appropriate bountyagent MCP tool instead."
            )

# Extract and check file-copy/move/link command destinations
if has_file_commands:
    for target in extract_file_command_targets(command):
        blocked = check_file(target)
        if blocked:
            block(
                f"BLOCKED: File command writes to '{blocked}' in session directory. "
                f"Use the appropriate bountyagent MCP tool instead."
            )

# Extract and check JS/Ruby/Perl write API targets
if has_write_api:
    for target in extract_write_api_targets(command):
        blocked = check_file(target)
        if blocked:
            block(
                f"BLOCKED: Write API targets '{blocked}' in session directory. "
                f"Use the appropriate bountyagent MCP tool instead."
            )

raise SystemExit(0)
PY
