#!/usr/bin/env python
"""
Upload to PyPI.
Requires: pip install build twine
Then:    python upload_pypi.py
Or manually:
    python -m build
    twine upload dist/*
"""
import subprocess, sys, os

root = os.path.dirname(os.path.abspath(__file__))
os.chdir(root)

print("[1] Building package...")
subprocess.run([sys.executable, "-m", "build"], check=True)

print("\n[2] Uploading to PyPI (dry-run)...")
result = subprocess.run(
    [sys.executable, "-m", "twine", "check", "dist/*"],
    capture_output=True, text=True
)
print(result.stdout)
if result.returncode != 0:
    print("WARNING:", result.stderr)

print("\nTo upload for real, run:")
print("  pip install build twine")
print("  TWINE_PASSWORD=<your-token> python -m twine upload dist/*")
