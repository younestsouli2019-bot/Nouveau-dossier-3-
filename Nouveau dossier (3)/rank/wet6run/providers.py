import os
import json
import urllib.request
import urllib.error

class ProviderResult:
    def __init__(self, text):
        self.text = text

class Provider:
    def generate(self, prompt):
        return ProviderResult(prompt)

class OpenAIProvider(Provider):
    def __init__(self):
        self.key = os.environ.get("OPENAI_API_KEY", "")
        self.model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        self.url = "https://api.openai.com/v1/chat/completions"
    def generate(self, prompt):
        if not self.key:
            return ProviderResult(prompt)
        data = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7
        }
        req = urllib.request.Request(self.url, data=json.dumps(data).encode("utf-8"))
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer " + self.key)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8")
                j = json.loads(body)
                c = j.get("choices", [])
                if c:
                    t = c[0]["message"]["content"]
                    return ProviderResult(t)
        except urllib.error.HTTPError as e:
            return ProviderResult(prompt)
        except urllib.error.URLError as e:
            return ProviderResult(prompt)
        return ProviderResult(prompt)

class AnthropicProvider(Provider):
    def __init__(self):
        self.key = os.environ.get("ANTHROPIC_API_KEY", "")
        self.model = os.environ.get("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
        self.url = "https://api.anthropic.com/v1/messages"
    def generate(self, prompt):
        if not self.key:
            return ProviderResult(prompt)
        data = {
            "model": self.model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}]
        }
        req = urllib.request.Request(self.url, data=json.dumps(data).encode("utf-8"))
        req.add_header("Content-Type", "application/json")
        req.add_header("x-api-key", self.key)
        req.add_header("anthropic-version", "2023-06-01")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8")
                j = json.loads(body)
                c = j.get("content", [])
                if c:
                    t = c[0].get("text", "")
                    return ProviderResult(t or prompt)
        except urllib.error.HTTPError as e:
            return ProviderResult(prompt)
        except urllib.error.URLError as e:
            return ProviderResult(prompt)
        return ProviderResult(prompt)

class GeminiProvider(Provider):
    def __init__(self):
        self.key = os.environ.get("GEMINI_API_KEY", "")
        self.model = os.environ.get("GEMINI_MODEL", "gemini-1.5-pro")
        self.url = "https://generativelanguage.googleapis.com/v1beta/models/" + self.model + ":generateContent?key="
    def generate(self, prompt):
        if not self.key:
            return ProviderResult(prompt)
        data = {"contents": [{"parts": [{"text": prompt}]}]}
        req = urllib.request.Request(self.url + self.key, data=json.dumps(data).encode("utf-8"))
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8")
                j = json.loads(body)
                c = j.get("candidates", [])
                if c:
                    parts = c[0]["content"].get("parts", [])
                    if parts:
                        t = parts[0].get("text", "")
                        return ProviderResult(t or prompt)
        except urllib.error.HTTPError as e:
            return ProviderResult(prompt)
        except urllib.error.URLError as e:
            return ProviderResult(prompt)
        return ProviderResult(prompt)

def pick_providers():
    ps = []
    ps.append(OpenAIProvider())
    ps.append(AnthropicProvider())
    ps.append(GeminiProvider())
    return ps
