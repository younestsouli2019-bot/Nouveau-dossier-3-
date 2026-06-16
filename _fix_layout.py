"""Fix nd3-clone: move root-level swarm files into khwarizmian_swarm/ subdirectory."""
import os, shutil

root = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\nd3-clone'
dst = os.path.join(root, 'khwarizmian_swarm')

root_files = {
    'base44_protocol.py', 'ethical_kernel.py', 'khwarizmian_plugins.py',
    'khwarizmian_swarm.py', 'khwarizmian_swarm_extended.py',
    'requirements.txt', 'run_swarm.py', 'swarm_agent.py',
    'pyproject.toml', 'upload_pypi.py', 'seed_external.py',
    'test_swarm.py', 'LICENSE', 'README.md', 'repo_metadata.json',
    '_run_extended.py', '_spread_all2.py'
}

for f in root_files:
    src = os.path.join(root, f)
    if os.path.exists(src):
        shutil.move(src, os.path.join(dst, f))
        print(f"Moved: {f}")

print("\nDone. Verifying key files...")
for f in ['ethical_kernel.py', 'khwarizmian_swarm_extended.py', 'test_swarm.py']:
    p = os.path.join(dst, f)
    print(f"  {'OK' if os.path.exists(p) else 'MISSING'}: {f}")
