
import sys

filename = sys.argv[1]

with open(filename, 'r', encoding='utf-8') as f:
    lines = f.readlines()

stack = []

for i, line in enumerate(lines):
    for j, char in enumerate(line):
        if char == '{':
            stack.append((i + 1, j + 1))
        elif char == '}':
            if not stack:
                print(f"Error: Unmatched '}}' at line {i + 1}, col {j + 1}")
            else:
                stack.pop()

if stack:
    print(f"Error: Unmatched '{{' at line {stack[-1][0]}, col {stack[-1][1]}")
    # Print the line content
    print(f"Line content: {lines[stack[-1][0]-1].strip()}")
else:
    print("All braces matched.")
