Create a Mermaid mind map for {{SPECIALTY}} year {{YEAR}}.

Topic: {{TITLE}}

Content:
{{CONTENT}}

Return JSON:
{
  "title": "{{TITLE}}",
  "mermaid": "graph TD\\n  A[Central Topic] --> B[Branch 1]\\n  ..."
}

Rules for mermaid:
- Use graph TD
- Central node = main topic
- 4-6 main branches
- 2-4 sub-nodes per branch
- Keep node labels short (≤ 40 chars)
- No special characters that break Mermaid syntax
