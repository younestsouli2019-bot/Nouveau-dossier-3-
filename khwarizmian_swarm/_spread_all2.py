import subprocess, sys, os, shutil

src = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\khwarizmian_swarm'
runner = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\swarm-runner-repo'
nd3 = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\nd3-clone'
swarm = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\swarm-push-main'

ignore_files = {
    '_output.txt', '_output2.txt', '_capture.py', '_run.py', '_run_bootstrap.py',
    'bootstrap.py', 'run.js', 'run.bat', '_install_and_run.ps1',
    '_copy_to_runner.py', '_sync_runner.py', '_spread_all.py'
}
ignore_dirs = {'__pycache__', '.git', 'node_modules'}

def copy_tree(src_root, dst_root):
    for root, dirs, files in os.walk(src_root):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        rel = os.path.relpath(root, src_root)
        dst_dir = os.path.join(dst_root, rel) if rel != '.' else dst_root
        os.makedirs(dst_dir, exist_ok=True)
        for f in files:
            if f in ignore_files:
                continue
            shutil.copy2(os.path.join(root, f), os.path.join(dst_dir, f))
    print(f"  -> {dst_root}")

repos = {runner: 'swarm-runner-repo', nd3: 'nd3-clone', swarm: 'swarm-push-main'}
for repo, name in repos.items():
    print(f"[{name}]")
    copy_tree(src, repo)

print("\nAll repos synced.")
