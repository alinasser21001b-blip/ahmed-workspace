import io
import json
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import fitz
import genanki
import markdown as md
from weasyprint import HTML

from app.core.constants import ArtifactType, JobStatus, JobType, PackStatus
from app.models import PackArtifact, PackJob, StudyPack, User
from app.schemas.pack_outputs import (
    AnkiOutput,
    KeywordsOutput,
    MindMapOutput,
    QuizOutput,
    SourcesOutput,
    StructureAnalysis,
    SummaryOutput,
)
from app.services.llm import llm_client, prompt_loader
from app.services.storage import storage
from sqlalchemy.ext.asyncio import AsyncSession


DISCLAIMER_FOOTER = (
    "MedMind IQ — أداة مراجعة دراسية. لا يقدّم تشخيصاً أو علاجاً. "
    "For academic review only."
)


async def extract_text_from_pdf(data: bytes) -> tuple[str, int]:
    doc = fitz.open(stream=data, filetype="pdf")
    pages = min(len(doc), 150)
    text_parts = []
    for i in range(pages):
        text_parts.append(doc.load_page(i).get_text())
    doc.close()
    text = "\n".join(text_parts).strip()
    if len(text) < 200:
        raise ValueError("INPUT_INVALID: PDF text too short")
    return text, pages


def render_pdf_from_markdown(title: str, body_md: str) -> bytes:
    html_body = md.markdown(body_md, extensions=["tables", "fenced_code"])
    html = f"""
    <html><head><meta charset='utf-8'>
    <style>
      body {{ font-family: DejaVu Sans, sans-serif; margin: 40px; line-height: 1.5; }}
      h1,h2,h3 {{ color: #1a365d; }}
      .footer {{ margin-top: 40px; font-size: 10px; color: #666; }}
    </style></head><body>
    <h1>{title}</h1>
    {html_body}
    <div class='footer'>{DISCLAIMER_FOOTER}</div>
    </body></html>
    """
    return HTML(string=html).write_pdf()


def render_mindmap_png(mermaid_source: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        mmd_path = Path(tmp) / "map.mmd"
        png_path = Path(tmp) / "map.png"
        mmd_path.write_text(mermaid_source, encoding="utf-8")
        try:
            subprocess.run(
                ["npx", "-y", "@mermaid-js/mermaid-cli", "-i", str(mmd_path), "-o", str(png_path), "-b", "white"],
                check=True,
                capture_output=True,
                timeout=60,
            )
            return png_path.read_bytes()
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            return render_mindmap_png_simple(mermaid_source)


def render_mindmap_png_simple(mermaid_source: str) -> bytes:
    # Minimal SVG fallback converted via weasyprint
    safe = mermaid_source.replace("<", "").replace(">", "")[:500]
    svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='800' height='400'>
      <rect width='100%' height='100%' fill='#f8fafc'/>
      <text x='20' y='40' font-size='16' fill='#1a365d'>Mind Map</text>
      <text x='20' y='80' font-size='12' fill='#334155'>{safe}</text>
    </svg>"""
    return HTML(string=svg).write_png()


def build_anki_deck(output: AnkiOutput) -> bytes:
    model = genanki.Model(
        1607392319,
        "MedMind Basic",
        fields=[{"name": "Front"}, {"name": "Back"}],
        templates=[
            {
                "name": "Card 1",
                "qfmt": "{{Front}}",
                "afmt": "{{FrontSide}}<hr id='answer'>{{Back}}",
            }
        ],
    )
    deck = genanki.Deck(abs(hash(output.deck_name)) % (10**10), output.deck_name)
    for card in output.cards:
        note = genanki.Note(model=model, fields=[card.front, card.back], tags=card.tags)
        deck.add_note(note)
    buf = io.BytesIO()
    genanki.Package(deck).write_to_file(buf)
    buf.seek(0)
    return buf.read()


def validate_outputs(
    summary: SummaryOutput,
    quiz: QuizOutput,
    anki: AnkiOutput,
    mindmap: MindMapOutput,
    structure: StructureAnalysis,
) -> None:
    if len(summary.markdown.split()) < 100:
        raise ValueError("G1: Summary too short")
    if len(quiz.questions) != 20:
        raise ValueError("G2: Quiz must have 20 questions")
    for q in quiz.questions:
        if set(q.options.keys()) != {"A", "B", "C", "D"}:
            raise ValueError("G2: Invalid quiz options")
    if len(anki.cards) < 30:
        raise ValueError("G3: Anki deck too small")
    if not mindmap.mermaid.strip():
        raise ValueError("G4: Empty mind map")
    if not structure.sections:
        raise ValueError("G5: Empty structure")


async def run_pack_pipeline(session: AsyncSession, pack: StudyPack, user: User) -> None:
    pack.status = PackStatus.PROCESSING
    await session.commit()

    if pack.input_type == "pdf" and pack.input_storage_key:
        pdf_bytes = storage.download_bytes(pack.input_storage_key)
        content, _ = await extract_text_from_pdf(pdf_bytes)
    elif pack.input_type in {"text", "topic"}:
        content = pack.topic or pack.title
    else:
        raise ValueError("INPUT_INVALID")

    context = {
        "SPECIALTY": user.specialty.value,
        "YEAR": str(user.study_year or 1),
        "TITLE": pack.title,
        "CONTENT": content[:50000],
        "TOPIC": pack.topic or pack.title,
    }
    system_prompt = prompt_loader.load("system_medical_reviewer.md")

    structure_raw = await llm_client.complete_json(
        system_prompt,
        prompt_loader.render("01_structure_analysis.md", **context),
    )
    structure = StructureAnalysis.model_validate(structure_raw)
    pack.title = structure.title

    summary_raw = await llm_client.complete_json(
        system_prompt,
        prompt_loader.render("02_summary.md", **context, STRUCTURE=json.dumps(structure_raw, ensure_ascii=False)),
    )
    summary = SummaryOutput.model_validate(summary_raw)

    keywords_raw = await llm_client.complete_json(system_prompt, prompt_loader.render("03_keywords.md", **context))
    keywords = KeywordsOutput.model_validate(keywords_raw)

    quiz_raw = await llm_client.complete_json(system_prompt, prompt_loader.render("04_quiz_mcq.md", **context))
    quiz = QuizOutput.model_validate(quiz_raw)

    anki_raw = await llm_client.complete_json(system_prompt, prompt_loader.render("05_anki_cards.md", **context))
    anki = AnkiOutput.model_validate(anki_raw)

    mindmap_raw = await llm_client.complete_json(system_prompt, prompt_loader.render("06_mindmap_mermaid.md", **context))
    mindmap = MindMapOutput.model_validate(mindmap_raw)

    sources_raw = await llm_client.complete_json(system_prompt, prompt_loader.render("07_sources.md", **context))
    sources = SourcesOutput.model_validate(sources_raw)

    validate_outputs(summary, quiz, anki, mindmap, structure)

    prefix = storage.pack_prefix(pack.user_id, pack.id)
    artifacts: list[tuple[ArtifactType, bytes, str, str]] = []

    summary_md = summary.markdown + f"\n\n## High Yield\n" + "\n".join(f"- {x}" for x in summary.high_yield_box)
    artifacts.append((ArtifactType.SUMMARY_MD, summary_md.encode("utf-8"), f"{prefix}/summary.md", "text/markdown"))
    artifacts.append(
        (
            ArtifactType.SUMMARY_PDF,
            render_pdf_from_markdown(summary.title, summary_md),
            f"{prefix}/summary.pdf",
            "application/pdf",
        )
    )

    keywords_txt = "\n".join(f"{'⭐' * k.importance} {k.term}: {k.definition}" for k in keywords.keywords)
    artifacts.append((ArtifactType.KEYWORDS_TXT, keywords_txt.encode("utf-8"), f"{prefix}/keywords.txt", "text/plain"))
    artifacts.append(
        (
            ArtifactType.KEYWORDS_JSON,
            keywords.model_dump_json(indent=2).encode("utf-8"),
            f"{prefix}/keywords.json",
            "application/json",
        )
    )

    quiz_md = "\n\n".join(
        f"### Q{q.id}. {q.stem}\n"
        + "\n".join(f"- **{k})** {v}" for k, v in q.options.items())
        + f"\n\n**Answer:** {q.correct} — {q.explanation}"
        for q in quiz.questions
    )
    artifacts.append((ArtifactType.QUIZ_JSON, quiz.model_dump_json(indent=2).encode("utf-8"), f"{prefix}/quiz.json", "application/json"))
    artifacts.append(
        (ArtifactType.QUIZ_PDF, render_pdf_from_markdown(f"Quiz — {pack.title}", quiz_md), f"{prefix}/quiz.pdf", "application/pdf")
    )

    artifacts.append((ArtifactType.ANKI_APKG, build_anki_deck(anki), f"{prefix}/deck.apkg", "application/octet-stream"))
    artifacts.append((ArtifactType.MINDMAP_MMD, mindmap.mermaid.encode("utf-8"), f"{prefix}/mindmap.mmd", "text/plain"))
    artifacts.append(
        (ArtifactType.MINDMAP_PNG, render_mindmap_png(mindmap.mermaid), f"{prefix}/mindmap.png", "image/png")
    )

    sources_md = "\n".join(f"- {r}" for r in sources.references) + f"\n\n{sources.disclaimer}"
    artifacts.append((ArtifactType.SOURCES_MD, sources_md.encode("utf-8"), f"{prefix}/sources.md", "text/markdown"))

    for artifact_type, data, key, mime in artifacts:
        storage.upload_bytes(key, data, mime)
        session.add(
            PackArtifact(
                study_pack_id=pack.id,
                artifact_type=artifact_type,
                storage_key=key,
                file_size_bytes=len(data),
                mime_type=mime,
            )
        )

    pack.status = PackStatus.COMPLETED
    pack.completed_at = datetime.now(timezone.utc)
    delivery_job = PackJob(study_pack_id=pack.id, job_type=JobType.DELIVER_PACK, status=JobStatus.PENDING)
    session.add(delivery_job)
    await session.commit()
