import os
import sys
from openai import OpenAI


def run_agent_pipeline(diff_content):
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    logic_prompt = f"Analyze this git diff for logical flaws, race conditions, or broken iPaaS data mappings:\n\n{diff_content}"
    logic_response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": logic_prompt}]
    )

    security_prompt = f"Analyze this git diff for security vulnerabilities, OWASP top 10, and hardcoded API secrets:\n\n{diff_content}"
    security_response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": security_prompt}]
    )

    synthesis_prompt = f"""
    You are the Lead Synthesis Agent. Combine the findings from the Logic Agent and Security Agent into a single, cohesive, highly accurate GitHub Markdown code review report.

    Logic Agent Report: {logic_response.choices[0].message.content}
    Security Agent Report: {security_response.choices[0].message.content}

    Format your final response cleanly with headers. Use bullet points. If everything looks perfect, explicitly state 'APPROVED'.
    """

    final_report = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": synthesis_prompt}]
    )

    return final_report.choices[0].message.content


if __name__ == "__main__":
    diff_file = sys.argv[1]
    with open(diff_file, 'r') as f:
        content = f.read()

    report = run_agent_pipeline(content)

    with open("ai_review_report.md", "w") as f:
        f.write(report)
    print("Agent review completed successfully.")
