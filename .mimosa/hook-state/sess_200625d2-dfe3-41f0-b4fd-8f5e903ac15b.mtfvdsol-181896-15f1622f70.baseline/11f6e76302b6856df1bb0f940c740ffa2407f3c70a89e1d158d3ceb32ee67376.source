import os
import argparse
from openai import OpenAI


def autonomous_self_heal(platform_target):
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    error_logs = f"Error: Payload validation failed for {platform_target}. Required field 'tenant_id' is missing."
    broken_code_file = f"src/adapters/{platform_target}_adapter.py"

    try:
        with open(broken_code_file, "r") as f:
            source_code = f.read()
    except FileNotFoundError:
        print(f"No adapter file found at {broken_code_file}, skipping.")
        return

    healing_prompt = f"""
    You are an Expert Systems Upgrades Engineer Agent.
    A multi-platform regression was triggered on target: '{platform_target}'.

    CRITICAL CONTEXT:
    - Failing Error Log: {error_logs}
    - Original Multi-Platform Source Code:
    ---
    {source_code}
    ---

    TASK:
    1. Analyze why the upgrade broke this specific integration.
    2. Rewrite the source code to natively patch the error.
    3. Return ONLY the completely functional, raw source code. Do not include markdown wraps or explanations.
    """

    print(f"Agent is analyzing code regressions for {platform_target}...")
    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=0.0,
        messages=[{"role": "user", "content": healing_prompt}]
    )

    patched_code = response.choices[0].message.content.strip()

    if patched_code.startswith("```"):
        patched_code = "\n".join(patched_code.split("\n")[1:-1])

    with open(broken_code_file, "w") as f:
        f.write(patched_code)

    print(f"Successfully auto-patched: {broken_code_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True)
    args = parser.parse_args()
    autonomous_self_heal(args.platform)
