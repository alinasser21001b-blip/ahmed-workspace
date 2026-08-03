Analyze the following medical study content for a {{SPECIALTY}} student in year {{YEAR}}.

Topic/Title hint: {{TITLE}}

Content:
{{CONTENT}}

Return JSON with this schema:
{
  "title": "string — concise topic title",
  "sections": [
    {
      "heading": "string",
      "bullets": ["key point 1", "key point 2"],
      "clinical_pearl": "optional high-yield pearl or null"
    }
  ],
  "high_yield_topics": ["topic1", "topic2"],
  "suggested_sources": ["Textbook Name — Chapter/Section"]
}

Create 4-8 logical sections. Focus on exam-relevant structure.
