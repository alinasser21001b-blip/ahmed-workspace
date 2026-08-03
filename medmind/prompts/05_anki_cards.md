Create Anki flashcards for {{SPECIALTY}} year {{YEAR}}.

Topic: {{TITLE}}

Content:
{{CONTENT}}

Return JSON:
{
  "deck_name": "{{TITLE}} — MedMind",
  "cards": [
    {
      "front": "question or term",
      "back": "concise answer",
      "tags": ["Year{{YEAR}}", "HighYield"],
      "card_type": "basic"
    }
  ]
}

Create 40-60 cards. Mix definitions, mechanisms, comparisons, and cloze-style fronts where appropriate.
Keep backs short (1-3 sentences max).
