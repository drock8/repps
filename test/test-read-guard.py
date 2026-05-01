#!/usr/bin/env python3
"""Unit tests for session-read-guard.sh hook."""
import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(__file__), "..", ".claude", "hooks", "session-read-guard.sh")
HOME = os.path.expanduser("~")
SESSION = f"{HOME}/bounty-agent-sessions/example.com"

TESTS = [
    ("Read findings.jsonl blocks",
     {"tool_input": {"file_path": f"{SESSION}/findings.jsonl"}},
     2,
     "bounty_read_findings"),
    ("Read report.md blocks",
     {"tool_input": {"file_path": f"{SESSION}/report.md"}},
     2,
     "bounty_read_session_summary"),
    ("Read attack_surface.json allows",
     {"tool_input": {"file_path": f"{SESSION}/attack_surface.json"}},
     0,
     None),
    ("Read outside session allows",
     {"tool_input": {"file_path": "/tmp/report.md"}},
     0,
     None),
    ("Bash cat findings blocks",
     {"tool_input": {"command": f"cat {SESSION}/findings.jsonl"}},
     2,
     "bounty_read_findings"),
    ("Bash head grade blocks",
     {"tool_input": {"command": f"head -n 5 {SESSION}/grade.json"}},
     2,
     "bounty_read_session_summary"),
    ("Bash tail http audit blocks",
     {"tool_input": {"command": f"tail -n 20 {SESSION}/http-audit.jsonl"}},
     2,
     "bounty_read_http_audit"),
    ("Bash jq verification blocks",
     {"tool_input": {"command": f"jq '.results[]' {SESSION}/verified-final.json"}},
     2,
     "bounty_read_session_summary"),
    ("Bash cat attack surface allows",
     {"tool_input": {"command": f"cat {SESSION}/attack_surface.json"}},
     0,
     None),
    ("Bash cat non-session allows",
     {"tool_input": {"command": "cat /tmp/example.md"}},
     0,
     None),
    ("Bash cat raw proof path blocks",
     {"tool_input": {"command": f"cat {SESSION}/raw-response-body.txt"}},
     2,
     "bounty_read_session_summary"),
]


def main():
    passed = 0
    failed = 0

    for desc, payload, expected, expected_text in TESTS:
        result = subprocess.run(
            ["bash", HOOK],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )
        ok = result.returncode == expected
        if ok and expected_text:
            ok = expected_text in result.stderr
        status = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
        print(f"  {status}: {desc}")
        if not ok:
            print(f"         expected exit {expected}, got {result.returncode}")
            if expected_text:
                print(f"         expected stderr to include: {expected_text}")
            if result.stderr.strip():
                print(f"         stderr: {result.stderr.strip()}")
            failed += 1
        else:
            passed += 1

    print(f"\n  {passed}/{passed + failed} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
