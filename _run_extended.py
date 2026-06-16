import subprocess, sys, os
root = r'c:\Users\Dell\Downloads\Nouveau dossier (3)\khwarizmian_swarm'
out = os.path.join(root, '_output2.txt')
result = subprocess.run([sys.executable, os.path.join(root, 'khwarizmian_swarm_extended.py')], cwd=root, capture_output=True, text=True, timeout=90)
with open(out, 'w') as f:
    f.write('STDOUT:\n' + result.stdout)
    f.write('\nSTDERR:\n' + result.stderr)
    f.write(f'\nEXIT: {result.returncode}\n')
print(f"Done -> {out}")
