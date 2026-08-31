import os
import argparse
from openai import OpenAI


def run_anti_regression(platform_target, environment):
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    regression_prompt = f"""
    You are a Platform Integration Regression Analyst.
    Audit the repository for platform-specific breakages after a code push.

    Target Platform: {platform_target}
    Target Environment: {environment}

    TASK:
    1. Identify any changes that would break {platform_target} adapters or connectors.
    2. Check for missing required fields in payload schemas.
    3. Check for breaking API version changes.
    4. Return a structured JSON report with status and findings.
    """

    response = client.chat.completions.create(
        model="gpt-4o",
        temperature=0.0,
        messages=[{"role": "user", "content": regression_prompt}]
    )

    result = response.choices[0].message.content
    print(f"Anti-Regression Report for {platform_target} ({environment}):")
    print(result)

    if "REGRESSION" in result.upper() or "FAIL" in result.upper():
        exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True)
    parser.add_argument("--env", required=True)
    args = parser.parse_args()
    run_anti_regression(args.platform, args.env)
