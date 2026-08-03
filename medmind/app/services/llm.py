from __future__ import annotations

import json
from pathlib import Path

from app.core.config import settings


class PromptLoader:
    def __init__(self, prompts_dir: Path | None = None) -> None:
        self.prompts_dir = prompts_dir or Path(__file__).resolve().parents[2] / "prompts"

    def load(self, name: str) -> str:
        path = self.prompts_dir / name
        if not path.exists():
            raise FileNotFoundError(f"Prompt not found: {path}")
        return path.read_text(encoding="utf-8")

    def render(self, name: str, **kwargs: str) -> str:
        template = self.load(name)
        for key, value in kwargs.items():
            template = template.replace(f"{{{{{key}}}}}", value)
        return template


class LLMClient:
    def __init__(self) -> None:
        self.provider = settings.llm_provider
        self.model = settings.llm_model
        self.prompts = PromptLoader()

    async def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        if self.provider == "anthropic" and settings.anthropic_api_key:
            return await self._anthropic_json(system_prompt, user_prompt)
        if settings.openai_api_key:
            return await self._openai_json(system_prompt, user_prompt)
        raise RuntimeError("No LLM API key configured")

    async def _anthropic_json(self, system_prompt: str, user_prompt: str) -> dict:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        message = await client.messages.create(
            model=self.model,
            max_tokens=8192,
            temperature=0.2,
            system=system_prompt + "\n\nRespond with valid JSON only. No markdown fences.",
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = message.content[0].text.strip()
        return self._parse_json(text)

    async def _openai_json(self, system_prompt: str, user_prompt: str) -> dict:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model=self.model if self.provider == "openai" else "gpt-4o",
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return self._parse_json(response.choices[0].message.content or "{}")

    @staticmethod
    def _parse_json(text: str) -> dict:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
            cleaned = cleaned.rsplit("```", 1)[0]
        return json.loads(cleaned)


llm_client = LLMClient()
prompt_loader = PromptLoader()
