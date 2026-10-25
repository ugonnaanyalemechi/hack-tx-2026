"""The one check command: lint, types, tests. Run before every commit and in CI."""

import subprocess
import sys


def main() -> None:
    steps = [
        ["ruff", "check", "."],
        ["ruff", "format", "--check", "."],
        ["mypy", "src"],
        ["pytest"],
    ]
    for step in steps:
        print(f"$ {' '.join(step)}")
        result = subprocess.run(step)
        if result.returncode != 0:
            sys.exit(result.returncode)
