Create exactly 20 MCQ questions for {{SPECIALTY}} year {{YEAR}} exam review.

Topic: {{TITLE}}

Content:
{{CONTENT}}

Return JSON:
{
  "questions": [
    {
      "id": 1,
      "stem": "question text",
      "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correct": "A",
      "explanation": "why correct + why others wrong briefly",
      "difficulty": "easy"
    }
  ]
}

Mix difficulty: ~30% easy, 50% medium, 20% hard.
No trick questions. All answers derivable from standard teaching.
