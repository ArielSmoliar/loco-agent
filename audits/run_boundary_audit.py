"""Repeat the explicit boundary audit; retain failures instead of marking xfail."""

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--repetitions", type=int, default=20)
parser.add_argument("--output", type=Path, default=Path("audits/results.json"))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
results = defaultdict(Counter)
first_failures = {}
for iteration in range(args.repetitions):
    with tempfile.TemporaryDirectory(prefix="loco-boundary-") as directory:
        xml = Path(directory) / "junit.xml"
        run = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                "audits/test_boundary_contracts.py",
                f"--junitxml={xml}",
            ],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if run.returncode not in (0, 1) or not xml.exists():
            raise RuntimeError(run.stdout + run.stderr)
        cases = ET.parse(xml).findall(".//testcase")
        if len(cases) != 23:
            raise RuntimeError(f"Expected 23 cases, got {len(cases)}")
        for case in cases:
            name = case.attrib["name"]
            failure = case.find("failure")
            if case.find("error") is not None or case.find("skipped") is not None:
                raise RuntimeError(f"Unexpected error/skip: {name}")
            status = "failed" if failure is not None else "passed"
            results[name][status] += 1
            if failure is not None:
                first_failures.setdefault(name, failure.attrib.get("message", ""))
        if iteration == 0:
            (root / "audits/first-run.log").write_text(run.stdout + run.stderr)
files = [
    "loco/convenience.py",
    "loco/tenant.py",
    "loco/multi_resource.py",
    "loco/adapters/langchain.py",
    "loco/adapters/google_adk.py",
    "loco/adapters/crewai.py",
]
report = {
    "source_commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True
    ).strip(),
    "python": platform.python_version(),
    "repetitions": args.repetitions,
    "source_sha256": {f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files},
    "results": dict(results),
    "first_failure_messages": first_failures,
}
args.output.write_text(json.dumps(report, indent=2) + "\n")
for name, counts in results.items():
    print(name, dict(counts))
sys.exit(1 if first_failures else 0)
