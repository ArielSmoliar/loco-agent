"""Tests for loco CLI."""

import subprocess
import sys


def test_doctor_runs():
    result = subprocess.run(
        [sys.executable, "-m", "loco.cli", "doctor"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert "LOCO Doctor" in result.stdout


def test_version_runs():
    result = subprocess.run(
        [sys.executable, "-m", "loco.cli", "version"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert "loco-agent" in result.stdout


def test_help_runs():
    result = subprocess.run(
        [sys.executable, "-m", "loco.cli", "--help"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert "doctor" in result.stdout


def test_unknown_command_fails():
    result = subprocess.run(
        [sys.executable, "-m", "loco.cli", "nonexistent"],
        capture_output=True, text=True,
    )
    assert result.returncode == 1
