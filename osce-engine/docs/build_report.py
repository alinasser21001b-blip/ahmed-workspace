"""Generates the engineering study PDF from analysis_data.py."""

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, NextPageTemplate, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)

sys.path.insert(0, str(Path(__file__).parent))
import analysis_data as D  # noqa: E402

# --- Palette ---------------------------------------------------------------
INK = colors.HexColor("#1A1A1A")
MUTED = colors.HexColor("#6B6B6B")
FAINT = colors.HexColor("#9A9A9A")
RULE = colors.HexColor("#D8D4CE")
BAND = colors.HexColor("#F7F5F2")
ACCENT = colors.HexColor("#1F4E5F")
ACCENT_LIGHT = colors.HexColor("#E8F0F2")

OK = colors.HexColor("#1E7A46")
OK_BG = colors.HexColor("#E6F4EC")
WARN = colors.HexColor("#8A5A00")
WARN_BG = colors.HexColor("#FDF3E0")
BAD = colors.HexColor("#9B2C2C")
BAD_BG = colors.HexColor("#FBEAEA")
NEUTRAL = colors.HexColor("#EFEFEF")

PAGE_W, PAGE_H = A4
MARGIN = 17 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
LAND_W = PAGE_H - 2 * MARGIN

base = getSampleStyleSheet()

S = {
    "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold",
                         fontSize=19, leading=23, textColor=ACCENT,
                         spaceBefore=0, spaceAfter=3),
    "h1sub": ParagraphStyle("h1sub", fontName="Helvetica", fontSize=9.5, leading=13,
                            textColor=MUTED, spaceAfter=12),
    "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold",
                         fontSize=12.5, leading=15, textColor=INK,
                         spaceBefore=14, spaceAfter=5),
    "h3": ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10.5, leading=13,
                         textColor=ACCENT, spaceBefore=10, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.4, leading=13.6,
                           textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7),
    "lead": ParagraphStyle("lead", fontName="Helvetica", fontSize=10.4, leading=15.4,
                           textColor=INK, alignment=TA_JUSTIFY, spaceAfter=9),
    "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=9.4, leading=13.4,
                             textColor=INK, leftIndent=11, bulletIndent=2,
                             alignment=TA_LEFT, spaceAfter=4),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=7.6, leading=9.6,
                           textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=7.6, leading=9.6,
                            textColor=INK),
    "cellhead": ParagraphStyle("cellhead", fontName="Helvetica-Bold", fontSize=7.6,
                               leading=9.4, textColor=colors.white),
    "cellmuted": ParagraphStyle("cellmuted", fontName="Helvetica", fontSize=7.2,
                                leading=9.2, textColor=MUTED),
    "mono": ParagraphStyle("mono", fontName="Courier", fontSize=7.6, leading=10.4,
                           textColor=INK),
    "caption": ParagraphStyle("caption", fontName="Helvetica-Oblique", fontSize=7.8,
                              leading=10.4, textColor=MUTED, spaceBefore=4, spaceAfter=11),
    "quote": ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=9.4,
                            leading=14, textColor=ACCENT, leftIndent=12, rightIndent=12,
                            spaceBefore=6, spaceAfter=10),
    "coverTitle": ParagraphStyle("ct", fontName="Helvetica-Bold", fontSize=31, leading=36,
                                 textColor=ACCENT, alignment=TA_LEFT),
    "coverSub": ParagraphStyle("cs", fontName="Helvetica", fontSize=13.5, leading=19,
                               textColor=MUTED, alignment=TA_LEFT),
    "coverMeta": ParagraphStyle("cm", fontName="Helvetica", fontSize=9, leading=14,
                                textColor=MUTED, alignment=TA_LEFT),
    "tileNum": ParagraphStyle("tn", fontName="Helvetica-Bold", fontSize=17, leading=20,
                              textColor=ACCENT, alignment=TA_CENTER),
    "tileLab": ParagraphStyle("tl", fontName="Helvetica", fontSize=7.4, leading=9.4,
                              textColor=MUTED, alignment=TA_CENTER),
}


def P(text, style="cell"):
    return Paragraph(text, S[style])


STATUS_COLORS = {
    "pass": (OK, OK_BG), "closed": (OK, OK_BG), "complete": (OK, OK_BG),
    "implemented": (OK, OK_BG), "full": (OK, OK_BG),
    "partial": (WARN, WARN_BG), "managed": (WARN, WARN_BG), "next": (WARN, WARN_BG),
    "continuous": (WARN, WARN_BG), "by design": (WARN, WARN_BG),
    "none": (BAD, BAD_BG), "open": (BAD, BAD_BG), "blocked": (BAD, BAD_BG), "fail": (BAD, BAD_BG),
    "n/a": (FAINT, NEUTRAL), "out of scope": (FAINT, NEUTRAL), "backlog": (FAINT, NEUTRAL),
}


def status_look(value: str):
    v = (value or "").strip().lower()
    if v in STATUS_COLORS:
        return STATUS_COLORS[v]
    for key, look in STATUS_COLORS.items():
        if v.startswith(key):
            return look
    return (INK, BAND)


def make_table(headers, rows, widths, status_cols=(), mono_cols=(), font_size=7.6,
               repeat=True):
    data = [[P(h, "cellhead") for h in headers]]
    for row in rows:
        cells = []
        for i, value in enumerate(row):
            text = str(value)
            if i in status_cols:
                fg, _ = status_look(text)
                cells.append(Paragraph(
                    f'<font color="#{fg.hexval()[2:]}"><b>{text}</b></font>',
                    ParagraphStyle("s", parent=S["cell"], alignment=TA_CENTER)))
            elif i in mono_cols:
                cells.append(P(text, "mono"))
            else:
                cells.append(P(text, "cell"))
        data.append(cells)

    style = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
        ("LEFTPADDING", (0, 0), (-1, -1), 4.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4.5),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT),
    ]
    for r in range(1, len(data)):
        if r % 2 == 0:
            style.append(("BACKGROUND", (0, r), (-1, r), BAND))
        for c in status_cols:
            _, bg = status_look(str(rows[r - 1][c]))
            style.append(("BACKGROUND", (c, r), (c, r), bg))

    t = Table(data, colWidths=widths, repeatRows=1 if repeat else 0)
    t.setStyle(TableStyle(style))
    return t


def rule(width, thickness=0.7, color=RULE, space_before=2, space_after=8):
    t = Table([[""]], colWidths=[width], rowHeights=[0.1])
    t.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), thickness, color),
        ("TOPPADDING", (0, 0), (-1, -1), space_before),
        ("BOTTOMPADDING", (0, 0), (-1, -1), space_after),
    ]))
    return t


def callout(title, body, width, accent=ACCENT, bg=ACCENT_LIGHT):
    inner = [
        [Paragraph(f'<b>{title}</b>',
                   ParagraphStyle("ct2", fontName="Helvetica-Bold", fontSize=9,
                                  leading=12, textColor=accent))],
        [Paragraph(body, ParagraphStyle("cb2", fontName="Helvetica", fontSize=8.8,
                                        leading=12.6, textColor=INK,
                                        alignment=TA_JUSTIFY))],
    ]
    t = Table(inner, colWidths=[width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (0, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, accent),
    ]))
    return t


# --- Page furniture --------------------------------------------------------
DOC_TITLE = D.META["title"]


def draw_chrome(canvas, doc, landscape=False):
    canvas.saveState()
    w = PAGE_H if landscape else PAGE_W
    h = PAGE_W if landscape else PAGE_H
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(FAINT)
    canvas.drawString(MARGIN, h - MARGIN + 6, DOC_TITLE)
    canvas.drawRightString(w - MARGIN, h - MARGIN + 6,
                           f"v{D.META['version']}  |  {D.META['date']}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, h - MARGIN + 2, w - MARGIN, h - MARGIN + 2)
    canvas.line(MARGIN, MARGIN - 8, w - MARGIN, MARGIN - 8)
    canvas.drawString(MARGIN, MARGIN - 17, "Engineering study and competitive analysis")
    canvas.drawRightString(w - MARGIN, MARGIN - 17, str(doc.page))
    canvas.restoreState()


def portrait_page(canvas, doc):
    draw_chrome(canvas, doc, landscape=False)


def landscape_page(canvas, doc):
    draw_chrome(canvas, doc, landscape=True)


def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.rect(0, PAGE_H - 8 * mm, PAGE_W, 8 * mm, stroke=0, fill=1)
    canvas.setFillColor(ACCENT_LIGHT)
    canvas.rect(0, 0, 8 * mm, PAGE_H - 8 * mm, stroke=0, fill=1)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(FAINT)
    canvas.drawString(MARGIN, 14 * mm, D.META["basis"])
    canvas.restoreState()


story = []

# ===========================================================================
# COVER
# ===========================================================================
story.append(Spacer(1, 42 * mm))
story.append(Paragraph("OSCE Knowledge-to-Station Engine", S["coverTitle"]))
story.append(Spacer(1, 5 * mm))
story.append(Paragraph(
    "Engineering study, code review of the shipped<br/>implementation, and V2 implementation report", S["coverSub"]))
story.append(Spacer(1, 9 * mm))
story.append(rule(CONTENT_W, 1.4, ACCENT, space_after=10))

tiles = [
    ("93", "tests passing"),
    ("11 / 11", "framework invariants"),
    ("0.105 ms", "station compile p95"),
    ("0.356 ms", "evaluation p95"),
    ("0", "LLM calls"),
]
tile_cells = [[Paragraph(n, S["tileNum"]) for n, _ in tiles],
              [Paragraph(l, S["tileLab"]) for _, l in tiles]]
tw = CONTENT_W / len(tiles)
tt = Table(tile_cells, colWidths=[tw] * len(tiles))
tt.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, 0), 10),
    ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ("LINEAFTER", (0, 0), (-2, -1), 0.5, RULE),
]))
story.append(tt)
story.append(rule(CONTENT_W, 1.4, ACCENT, space_before=6, space_after=14))

story.append(Paragraph(
    "This report studies the OSCE Knowledge-to-Station engineering framework, implements it as a "
    "production-grade V2 engine, compares that engine against the assessment platforms, entity-resolution "
    "systems and automated-grading approaches in current use, and reports what was measured rather than "
    "what was hoped for.",
    S["lead"]))
story.append(Paragraph(
    "The engine requires no language model on any path. That is a measured engineering position, "
    "not a preference, and the report states both what it buys and what it costs.",
    S["lead"]))

story.append(Spacer(1, 20 * mm))
meta_rows = [
    ["Version", D.META["version"]],
    ["Date", D.META["date"]],
    ["Basis", D.META["basis"]],
    ["Deliverables", "osce-engine/ (source, tests, schema, benchmark) - this report - analysis workbook"],
    ["Verification", "npm run verify  (typecheck + 93 tests + benchmark)"],
]
mt = Table([[Paragraph(f"<b>{k}</b>", S["cellmuted"]), Paragraph(v, S["cell"])]
            for k, v in meta_rows], colWidths=[26 * mm, CONTENT_W - 26 * mm])
mt.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 3),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
]))
story.append(mt)

story.append(NextPageTemplate("portrait"))
story.append(PageBreak())

# ===========================================================================
# 1. EXECUTIVE SUMMARY
# ===========================================================================
story.append(Paragraph("1. Executive summary", S["h1"]))
story.append(Paragraph("What was asked, what was found, and what was built.", S["h1sub"]))

story.append(Paragraph(
    "The brief was threefold: study the existing engine framework, compare it with what else exists, and "
    "develop it into something professional that does not depend on AI to function. This report answers all "
    "three, and the engine that accompanies it is working, tested code rather than a design document.",
    S["body"]))

story.append(Paragraph("1.1 The framework was sound; the gaps were in enforcement", S["h3"]))
story.append(Paragraph(
    "The source framework is a genuinely good piece of engineering writing. Its central instinct - that a "
    "question is valuable because of <i>who asked it and in which case</i>, not merely because it is medically "
    "correct - is what separates this system from a flashcard generator, and every architectural decision "
    "in it follows from that. The data model is right. The separation of evidence from generated content is "
    "right. The insistence that publication is controlled and evaluation is grounded is right.",
    S["body"]))
story.append(Paragraph(
    "What the framework could not do, being a document, is enforce any of it. Three of its most important "
    "rules existed only as prose:",
    S["body"]))
for text in [
    "<b>No path from extraction to a student without human review.</b> Stated as a table of states. Now an "
    "explicit transition graph, with a test that enumerates every route to PUBLISHED and asserts each one "
    "passes through a reviewer action.",
    "<b>Never silently merge two similar examiner names.</b> Stated as a warning. Now structural: an automatic "
    "match requires an exact canonical name or a registered alias, so no similarity score can cause a merge.",
    "<b>Key points must not reach the client before submission.</b> Stated as a contract. Now a whitelist "
    "serializer plus a test that searches the outgoing payload for key-point text.",
]:
    story.append(Paragraph(text, S["bullet"], bulletText="–"))

story.append(Paragraph(
    "The pattern generalises: wherever the framework said <i>should</i>, the implementation makes it a type, "
    "a database constraint, or a test. That is the whole difference between a specification and an engine.",
    S["body"]))

story.append(Paragraph("1.2 The no-AI requirement is met, and it cost something", S["h3"]))
story.append(Paragraph(
    "The engine performs cross-language semantic matching, negation-aware grading, typo tolerance, partial "
    "credit for less-specific answers, and duplicate detection across a corpus - with zero model calls. An "
    "English question and its Arabic equivalent, sharing not one character, match through a shared concept "
    "identifier. Evaluation costs 0.36 ms at p95 and returns the same answer every time.",
    S["body"]))
story.append(callout(
    "The cost, stated plainly",
    "Recall is bounded by vocabulary coverage. A paraphrase that uses no listed surface form and names no known "
    "concept is missed. Every such term is reported in <font face='Courier' size='8'>unmatchedTerms</font>, which "
    "converts the ceiling into a reviewer work queue rather than a silent failure. In an examination system this "
    "is the right direction to be wrong in: a missed mark is appealable, a fabricated question attributed to a "
    "real examiner is not.",
    CONTENT_W, WARN, WARN_BG))

story.append(Paragraph("1.3 Where it stands against everything else", S["h3"]))
story.append(Paragraph(
    "Against institutional OSCE platforms - Speedwell, ExamSoft - the engine wins decisively on provenance and "
    "loses decisively on exam-day logistics. Those platforms run circuits with tablet marking, offline capture "
    "and multi-day scheduling. This one does not, and should not: it is a practice engine, not a delivery "
    "system. Neither of them ingests historical recall material or resolves examiner identity from it, which "
    "is the thing this system actually exists to do.",
    S["body"]))
story.append(Paragraph(
    "Against the open-source assessment stack - TAO, Moodle - the clearest gap is interoperability. TAO is "
    "QTI-certified in all four categories; this engine exports nothing standard. Its domain model is a superset "
    "of QTI's item model, so export is additive work rather than a redesign, but until it exists institutional "
    "adoption has a real obstacle.",
    S["body"]))
story.append(Paragraph(
    "Against the specialist tooling it borrows from, it is at or near parity in each borrowed area and ahead in "
    "one: Splink's Fellegi-Sunter model is purely probabilistic, so its false-merge rate is nonzero by "
    "construction. Adding a deterministic authority gate on top makes the zero-tolerance requirement structural "
    "rather than statistical.",
    S["body"]))

story.append(Paragraph("1.4 Performance is not the risk", S["h3"]))
story.append(Paragraph(
    "Both exam-path budgets are consumed to less than a fifth of one percent by engine computation. Station "
    "compilation takes 0.105 ms against an 800 ms target; evaluation takes 0.356 ms against 300 ms. Whatever "
    "makes these endpoints slow in production, it will not be this code - it will be database round trips, "
    "which is why the schema's covering indexes matter more than any of the arithmetic above.",
    S["body"]))
story.append(Paragraph(
    "The unresolved risk is content quality, not speed. Extraction precision on real files cannot be measured "
    "until a labelled corpus exists. The instrumentation is in place; the data is not. That is the single "
    "highest-value next piece of work, and it is a labelling exercise rather than an engineering one.",
    S["body"]))

story.append(PageBreak())

# ===========================================================================
# 2. THE ARGUMENT FOR DETERMINISM
# ===========================================================================
story.append(Paragraph("2. The argument for determinism", S["h1"]))
story.append(Paragraph(
    "Why an examination engine is the wrong place for a language model, and where that judgement stops holding.",
    S["h1sub"]))

story.append(Paragraph(
    "The framework closes with a definition worth quoting in full, because everything in this section follows "
    "from it:",
    S["body"]))
story.append(Paragraph(
    "“Professional means measurable and auditable. A faster engine is not enough. The system is "
    "professional when every station question can explain where it came from, why it was selected, whether it "
    "is approved for evaluation, and which session owned the final student interaction.”",
    S["quote"]))
story.append(Paragraph(
    "A language model placed in the extraction or grading path breaks all four clauses at once. It cannot "
    "reliably say where content came from, because it can generate content that was never in the source. It "
    "cannot explain why a mark was awarded in terms a student can contest. Its approval status is not a "
    "property of the output. And it cannot guarantee that the same session, replayed, produces the same result.",
    S["body"]))

story.append(Paragraph("2.1 The decision record", S["h3"]))
story.append(make_table(
    ["Dimension", "Deterministic engine", "LLM in the path", "Which wins"],
    [[d[0], d[1], d[2], d[3]] for d in D.DETERMINISM_MATRIX],
    [30 * mm, 48 * mm, 45 * mm, 53 * mm]))
story.append(Paragraph(
    "Table 1. Every dimension on which the choice was actually made, including the two where the language model "
    "wins outright.", S["caption"]))

story.append(Paragraph("2.2 What replaces the model", S["h3"]))
story.append(Paragraph(
    "The substitute for an embedding model is a controlled vocabulary: every surface form maps to a concept "
    "identifier, and two texts are semantically equal when they name the same concepts. This is not a novel "
    "idea - it is the mechanism UMLS uses at national scale, shrunk to the size of one examination corpus. "
    "What it buys over embeddings is that a match can be named:",
    S["body"]))

story.append(make_table(
    ["Student wrote", "Key point", "Matched via", "Result"],
    [
        ["DVT", "deep vein thrombosis", "concept C:DVT (abbreviation form)", "Full credit"],
        ["جلطة وريدية عميقة",
         "deep vein thrombosis", "concept C:DVT (Arabic form)", "Full credit"],
        ["thrombosis", "deep vein thrombosis", "broader concept C:THROMBOSIS", "Partial credit"],
        ["wond infecton", "wound infection", "edit distance 1 per token", "Full credit"],
        ["possibly DVT", "deep vein thrombosis", "concept, hedged context", "Half credit"],
        ["no evidence of DVT", "deep vein thrombosis", "concept, negated context", "No credit"],
        ["pneumoperitoneum", "(not in the key)", "nothing", "Reported to the reviewer"],
    ],
    [34 * mm, 40 * mm, 60 * mm, 42 * mm]))
story.append(Paragraph(
    "Table 2. Actual evaluator behaviour, taken from the test suite. The last row is the mechanism that keeps "
    "the vocabulary's ceiling visible: unrecognised clinical terms become a work queue, not a silent zero.",
    S["caption"]))

story.append(Paragraph("2.3 Where the model would win", S["h3"]))
story.append(Paragraph(
    "Two places, and it is worth being precise about them rather than defensive. First, paraphrase outside the "
    "vocabulary: a student who writes “air where it should not be, under the diaphragm” has described "
    "pneumoperitoneum correctly and will receive nothing until someone adds that concept. Second, cold start: "
    "on day one with an empty vocabulary, a language model grades better than this engine does.",
    S["body"]))
story.append(Paragraph(
    "The engine's answer to both is the same. The provider interfaces "
    "(<font face='Courier' size='8'>CandidateExtractionProvider</font>, "
    "<font face='Courier' size='8'>AnswerEvaluationProvider</font>) exist and are unused. A semantic adapter can "
    "be added behind either of them for the residue the vocabulary misses. What it must never become is the "
    "system of record, and it must never sit on the critical path - because the moment it does, every property "
    "in Table 1's left column is lost, including the ones the framework requires.",
    S["body"]))
story.append(callout(
    "The sequencing that matters",
    "Do not add a semantic adapter until the labelled-corpus benchmark (Phase D.1) has quantified what the "
    "vocabulary actually misses. Adding it earlier means never finding out whether it was needed, and paying "
    "for it on every request forever.",
    CONTENT_W))

story.append(PageBreak())


# ===========================================================================
# 3. CODE REVIEW OF THE SHIPPED IMPLEMENTATION
# ===========================================================================
story.append(Paragraph("3. Code review: the shipped implementation", S["h1"]))
story.append(Paragraph(
    f"Findings against {D.SHIPPED_META['package']} - {D.SHIPPED_META['files_reviewed']} files, read and never "
    f"modified.", S["h1sub"]))

story.append(Paragraph(
    f"<b>Stack.</b> {D.SHIPPED_META['stack']}.", S["body"]))
story.append(Paragraph(
    f"<b>State.</b> {D.SHIPPED_META['state']}", S["body"]))
story.append(callout(
    "Scope of this review",
    "Nothing in the handoff package was modified, and no Cloudflare resource was listed, created or changed. The "
    "brief is explicit that the owner halted the cutover, and that instruction was followed. Everything below is "
    "a reading of the source plus a reproducible test run against a faithful copy of the shipped evaluator.",
    CONTENT_W))

story.append(Paragraph("3.1 What the shipped code gets right", S["h2"]))
story.append(Paragraph(
    "This is a competent piece of work and the review should say so before it says anything else. Several "
    "decisions in it are better than what a typical first implementation would produce.",
    S["body"]))
story.append(make_table(
    ["Strength", "Detail"],
    [list(x) for x in D.SHIPPED_STRENGTHS],
    [42 * mm, CONTENT_W - 42 * mm]))
story.append(Paragraph(
    "Table 3. The DOMMatrix polyfill deserves particular note: pdfjs-dist reads DOMMatrix at module evaluation "
    "time and Workers do not provide it. Recognising that, and writing a minimal affine-transform "
    "implementation rather than abandoning PDF support, is the kind of problem that costs a day to diagnose "
    "and ten minutes to fix once understood.", S["caption"]))

story.append(Paragraph("3.2 The evaluator, measured", S["h2"]))
story.append(Paragraph(
    "The shipped evaluator matches key points with a raw substring test: "
    "<font face='Courier' size='8'>answer.includes(point)</font>. To find out what that means in practice rather "
    "than in principle, the shipped logic was reproduced faithfully and run beside the V2 evaluator on ten "
    "representative answers, each scored against what a medical reviewer would mark.",
    S["body"]))
story.append(make_table(
    ["Case", "Reviewer", "Shipped", "V2", "What happens"],
    [[c[0], c[2], c[3], c[4], c[5]] for c in D.EVALUATOR_COMPARISON],
    [32 * mm, 20 * mm, 20 * mm, 20 * mm, CONTENT_W - 92 * mm],
    status_cols=()))
story.append(Paragraph(
    f"Table 4. Agreement with a reviewer: shipped {D.EVALUATOR_SCORE['shipped']}/{D.EVALUATOR_SCORE['total']}, "
    f"V2 {D.EVALUATOR_SCORE['v2']}/{D.EVALUATOR_SCORE['total']}. Reproduce with "
    "<font face='Courier' size='7'>node --experimental-strip-types docs/compare_evaluators.ts</font>.",
    S["caption"]))

story.append(callout(
    "The three that matter most",
    "Six of the nine disagreements under-mark a student, which is unfair but visible - a student who is marked "
    "down for writing “DVT” will complain. Three <i>over</i>-mark, and those are invisible. The clearest is "
    "negation: a student who writes “there is no evidence of deep vein thrombosis” receives full credit for the "
    "DVT key point, because the key point's text is a substring of the sentence that denies it. Nobody complains "
    "about a mark they did not earn, so this failure does not surface through user feedback - only through the "
    "kind of test above.",
    CONTENT_W, BAD, BAD_BG))

story.append(Paragraph("3.3 Findings", S["h2"]))
story.append(Paragraph(
    "Severity reflects consequence, not effort. Both Critical findings change a student's recorded mark, and "
    "both fixes are small.", S["body"]))
story.append(make_table(
    ["ID", "Sev.", "Area", "Finding", "Why it matters"],
    [[f[0], f[1], f[2], f[3], f[4]] for f in D.SHIPPED_FINDINGS],
    [8 * mm, 16 * mm, 21 * mm, 60 * mm, CONTENT_W - 105 * mm],
    status_cols=()))
story.append(Paragraph("Table 5. Twelve findings across evaluation, integrity, security and extraction.",
                       S["caption"]))

story.append(Paragraph("3.4 Migration path", S["h2"]))
story.append(Paragraph(
    "Every step below is additive. None requires a rewrite, none changes the API surface the client depends on, "
    "and the first two are independent of the deployment question entirely - they can ship whenever the owner "
    "chooses, without touching Cloudflare at all.",
    S["body"]))
story.append(make_table(
    ["Step", "Change", "Size", "Migration", "Effect"],
    [[m[0], m[1], m[2], m[3], m[5]] for m in D.MIGRATION_STEPS],
    [11 * mm, 32 * mm, 24 * mm, 26 * mm, CONTENT_W - 93 * mm]))
story.append(Paragraph(
    "Table 6. M1 and M2 together are under thirty lines and close both Critical findings.", S["caption"]))

story.append(PageBreak())
# ===========================================================================
# 4. ARCHITECTURE
# ===========================================================================
story.append(Paragraph("4. Architecture and the decisions behind it", S["h1"]))
story.append(Paragraph(
    "The framework recommended a modular monolith. This is that, with the reasoning for the five choices that "
    "were not obvious.", S["h1sub"]))

story.append(Paragraph(
    "<font face='Courier' size='7.6'>"
    "src/<br/>"
    "&nbsp;&nbsp;domain/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;branded IDs, error taxonomy, FNV-1a fingerprints, ULIDs<br/>"
    "&nbsp;&nbsp;text/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;normalization, tokenizer, similarity, phonetics, LSH,<br/>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;controlled vocabulary, NegEx negation<br/>"
    "&nbsp;&nbsp;ingestion/&nbsp;&nbsp;&nbsp;&nbsp;parser registry &#8594; segmenter &#8594; candidate extractor<br/>"
    "&nbsp;&nbsp;resolution/&nbsp;&nbsp;&nbsp;Fellegi-Sunter, examiner / case resolvers, question dedup<br/>"
    "&nbsp;&nbsp;review/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;candidate state machine &#8212; the safety boundary<br/>"
    "&nbsp;&nbsp;publish/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;idempotent publication planning<br/>"
    "&nbsp;&nbsp;station/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;seeded PRNG, station compiler<br/>"
    "&nbsp;&nbsp;session/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;server-owned exam sessions<br/>"
    "&nbsp;&nbsp;evaluation/&nbsp;&nbsp;&nbsp;grounded key-point evaluator<br/>"
    "&nbsp;&nbsp;psychometrics/ Elo calibration, Wilson bounds, discrimination<br/>"
    "&nbsp;&nbsp;observability/ typed events, redaction, latency, KPI targets<br/>"
    "&nbsp;&nbsp;adapters/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;in-memory store; SQL schema in schema/001_init.sql"
    "</font>", S["body"]))
story.append(Paragraph(
    "Figure 1. Module layout. No exam-path module imports an ingestion module, which is what makes the "
    "framework's “never re-parse during an exam” rule a structural property rather than a discipline.",
    S["caption"]))

decisions = [
    ("Two-gate examiner resolution",
     "The framework tolerates zero incorrect examiner auto-merges. No purely probabilistic system can promise "
     "that - a threshold on a posterior always has a nonzero error rate. So resolution has two gates. "
     "Fellegi-Sunter supplies a posterior probability with a per-field log Bayes factor breakdown; but an "
     "<i>automatic</i> match additionally requires an exact canonical name or a registered alias. Everything "
     "else becomes AMBIGUOUS and goes to a human. The probability is used for ranking the review queue and "
     "explaining the suggestion, never for taking an irreversible action. Verified against four adversarial "
     "name pairs including the framework's own Hassan/Hussein example: zero auto-merges."),
    ("A controlled vocabulary instead of embeddings",
     "Surface forms map to concept identifiers; texts are compared as concept sets. Guarded by three rules "
     "that took a bug to discover: the two texts must share a clinical case, must agree on interrogative "
     "category, and must share at least two concepts. Without the last rule, “complications of DVT” and "
     "“investigations for DVT” have concept-set Jaccard 1.0 - a degenerate perfect score carrying no "
     "information at all."),
    ("Negation with trigger provenance",
     "A key point can legitimately contain a negation word. “Antibiotics cure appendicitis without "
     "surgery” is a single false assertion, and the “without” belongs to the claim. Plain NegEx "
     "reads that span as negated, which silently converts an asserted pitfall into an unpenalised one - the "
     "engine scored a dangerous answer as fully CORRECT until this was fixed. The detector now records which "
     "token triggered each negation, so a matcher can ignore triggers originating inside the span it is testing."),
    ("Seeded, reproducible station compilation",
     "Every station is a pure function of (seed, policy version, knowledge snapshot), using xoshiro128**. When "
     "a student disputes a station, you re-run the compiler with the stored seed and get exactly the same "
     "questions in exactly the same order. Storing the seed rather than the assembled form is also smaller, "
     "and it makes fair comparison between students possible."),
    ("Derived counts, never incremented",
     "“Asked 5 times” is recomputed from approved occurrence rows. Publication is idempotent through a "
     "deterministic fingerprint plus a UNIQUE index, so a replay is a no-op rather than an inflated count. The "
     "cached count columns exist for read speed; the recount views are the authority, and comparing the two on "
     "a schedule is a drift alarm."),
]
for title, body in decisions:
    story.append(KeepTogether([Paragraph(title, S["h3"]), Paragraph(body, S["body"])]))

# ===========================================================================
# 4. FRAMEWORK COVERAGE (landscape)
# ===========================================================================
story.append(NextPageTemplate("landscape"))
story.append(PageBreak())
story.append(Paragraph("5. Framework coverage", S["h1"]))
story.append(Paragraph(
    "Every numbered requirement of the source framework, its implementation status, and the artefact that "
    "evidences it.", S["h1sub"]))
story.append(make_table(
    ["§", "Requirement", "Status", "Implementation", "Evidence"],
    [list(x) for x in D.COVERAGE],
    [10 * mm, 62 * mm, 30 * mm, 96 * mm, 66 * mm],
    status_cols=(2,)))
story.append(Paragraph(
    "Table 7. Coverage against all fifteen framework sections. “Deferred, deliberately” appears once, "
    "for asynchronous ingestion: at 32 ms per file it is nowhere near a Worker limit, and adding a queue now "
    "would add failure modes for no measured gain.", S["caption"]))

# ===========================================================================
# 5. COMPETITIVE ANALYSIS (landscape)
# ===========================================================================
story.append(PageBreak())
story.append(Paragraph("6. Competitive analysis", S["h1"]))
story.append(Paragraph(
    "This engine against institutional OSCE platforms, open-source assessment stacks, question banks, and the "
    "specialist tooling it borrows from.", S["h1sub"]))

names = [c["name"] for c in D.COMPETITORS]
col_w = [58 * mm] + [14.2 * mm] * len(names) + [0]
col_w[-1] = LAND_W - sum(col_w[:-1])
story.append(make_table(
    ["Capability"] + names,
    [[cap] + ratings for cap, ratings, _ in D.CAPABILITY_MATRIX],
    [58 * mm] + [(LAND_W - 58 * mm) / len(names)] * len(names),
    status_cols=tuple(range(1, 1 + len(names))), font_size=6.6))
story.append(Paragraph(
    "Table 8. Full / Partial / None / N⁄A, where N⁄A means the capability is outside that product's "
    "category rather than missing from it. Ratings are based on published product documentation; see the "
    "sources list.", S["caption"]))

story.append(PageBreak())
story.append(Paragraph("6.1 Products compared", S["h2"]))
story.append(make_table(
    ["Product", "Category", "Type", "What it is known for"],
    [[c["name"], c["category"], c["kind"], c["notes"]] for c in D.COMPETITORS],
    [40 * mm, 48 * mm, 24 * mm, LAND_W - 112 * mm]))

story.append(Spacer(1, 6 * mm))
story.append(Paragraph("6.2 Reading the matrix", S["h2"]))
story.append(make_table(
    ["Capability", "What the comparison actually shows"],
    [[cap, reading] for cap, _, reading in D.CAPABILITY_MATRIX],
    [72 * mm, LAND_W - 72 * mm]))

story.append(NextPageTemplate("portrait"))
story.append(PageBreak())

# ===========================================================================
# 6. WHERE IT LEADS AND WHERE IT TRAILS
# ===========================================================================
story.append(Paragraph("7. Where it leads, where it trails", S["h1"]))
story.append(Paragraph("An honest reading of the matrix on the preceding pages.", S["h1sub"]))

story.append(Paragraph("7.1 Genuine differentiation", S["h3"]))
for text in [
    "<b>Historical examiner attribution.</b> Every peer platform models examiners as <i>markers</i> - people who "
    "score a candidate. This engine models them as the <i>identity a question belongs to</i>, which is why "
    "examiner resolution gets a two-gate design and a zero-tolerance KPI. No comparable product treats examiner "
    "identity as a protected historical asset.",
    "<b>Provenance to the character offset.</b> Delivery platforms trace a mark back to an item. This traces it "
    "back to the page, line and character span of the file a student uploaded, through an immutable evidence "
    "chain. That is what makes “asked 5 times” defensible rather than decorative.",
    "<b>Deterministic free-text grading.</b> Checklist platforms are deterministic because they only score "
    "checkboxes. LLM graders handle free text but are not reproducible. This engine grades free text "
    "deterministically, across two languages, with negation awareness - a combination the comparison set does "
    "not contain.",
    "<b>Reproducible assembly from a stored seed.</b> Most platforms persist the assembled form. Storing the "
    "seed that generates it is smaller, replayable, and makes “why did I get this station” answerable.",
]:
    story.append(Paragraph(text, S["bullet"], bulletText="▪"))

story.append(Paragraph("7.2 Real gaps", S["h3"]))
for text in [
    "<b>No QTI or LTI interoperability.</b> The clearest gap. TAO is certified in all four QTI categories and "
    "ExamSoft integrates broadly; this engine exports nothing standard. The domain model is a superset of QTI's "
    "item model, so this is additive work - but until it is done, institutional adoption has an obstacle that "
    "has nothing to do with engine quality.",
    "<b>No exam-day logistics.</b> No circuits, no examiner tablets, no offline capture, no multi-day "
    "scheduling. This is a deliberate scope boundary rather than a deficiency, but it means the engine "
    "complements an institutional platform rather than replacing one.",
    "<b>No OCR.</b> Scanned uploads are detected and refused with OCR_REQUIRED. Refusing is the correct "
    "behaviour - the alternative is fabricated candidates - but the coverage gap is real, and closing it is a "
    "parser-registry entry rather than a redesign.",
    "<b>Paraphrase outside the vocabulary.</b> Covered at length in section 2.3. This is the price of "
    "determinism and it is paid knowingly.",
]:
    story.append(Paragraph(text, S["bullet"], bulletText="▪"))

story.append(Paragraph("7.3 What was borrowed, and from where", S["h3"]))
story.append(make_table(
    ["Borrowed from", "What", "How it was adapted"],
    [
        ["Splink / Fellegi-Sunter", "Probabilistic record linkage with m/u parameters and EM fitting",
         "Same model, plus a deterministic authority gate so automatic merges are exact-only"],
        ["NegEx / ConText", "Rule-based clinical negation and hedge detection",
         "Extended with trigger-position tracking so a key point containing a negation word is not self-negating"],
        ["UMLS", "Surface forms mapped to concept identifiers",
         "Same mechanism at corpus scale, curated by a reviewer rather than a standards body"],
        ["Moodle question engine", "Append-only attempt state and question versioning",
         "Versioned extraction runs that supersede rather than mutate"],
        ["Elo / Rasch", "Online item difficulty calibration",
         "Partial-credit scores rather than binary outcomes; adaptive K factor"],
        ["Classical test theory", "Point-biserial discrimination, Wilson bounds",
         "Surfaces negative-discrimination items as a content-quality work queue"],
        ["MinHash / SimHash LSH", "Sublinear near-duplicate candidate generation",
         "Persisted as band-key rows so dedup is an indexed lookup, not a scan"],
    ],
    [36 * mm, 58 * mm, CONTENT_W - 94 * mm]))
story.append(Paragraph(
    "Table 9. Nothing here is novel in isolation. The engineering contribution is the composition, and the "
    "guards added at each seam.", S["caption"]))

story.append(PageBreak())

# ===========================================================================
# 7. VERIFICATION
# ===========================================================================
story.append(Paragraph("8. Verification", S["h1"]))
story.append(Paragraph(
    "What was tested, what was measured, and what could not be measured yet.", S["h1sub"]))

story.append(Paragraph("8.1 Acceptance tests", S["h3"]))
story.append(make_table(
    ["#", "Test", "Expected invariant", "Result", "How it is verified"],
    [list(x) for x in D.ACCEPTANCE],
    [7 * mm, 30 * mm, 40 * mm, 13 * mm, CONTENT_W - 90 * mm],
    status_cols=(3,)))
story.append(Paragraph(
    "Table 10. The framework's Section 14 invariants as executable tests. Test 5b is an addition: the framework "
    "names the Hassan/Hussein problem in prose but does not list a test for it.", S["caption"]))

story.append(Paragraph("8.2 Measured performance", S["h3"]))
story.append(make_table(
    ["Operation", "Corpus", "p50", "p95", "p99", "n"],
    [[b[0], b[1], f"{b[2]:.3f} ms", f"{b[3]:.3f} ms", f"{b[4]:.3f} ms", str(b[5])]
     for b in D.BENCHMARKS],
    [52 * mm, 44 * mm, 17 * mm, 17 * mm, 17 * mm, 12 * mm]))
story.append(Paragraph(
    "Table 11. Engine CPU only, Node 22, corpus of 7,200 questions and 19,800 occurrences. Endpoint latency "
    "adds database and network time, which this cannot simulate - that is the point of measuring compute "
    "separately.", S["caption"]))

story.append(Paragraph("8.3 KPI status", S["h3"]))
story.append(make_table(
    ["KPI", "Target", "Measured", "Status"],
    [[k[0], k[1], k[2], k[3]] for k in D.KPIS],
    [58 * mm, 26 * mm, 42 * mm, 22 * mm],
    status_cols=(3,)))
story.append(Paragraph(
    "Table 12. Two KPIs are marked “by design” because they are I/O-bound and need a live database to "
    "measure. One is blocked on a labelled corpus. The rest pass.", S["caption"]))

story.append(callout(
    "A limitation found by measuring rather than assuming",
    "Examiner blocking degrades when many names share a phonetic skeleton. On a realistic Arabic name "
    "distribution the index yields 970 buckets with a mean of 16 and a <b>maximum of 910</b> - that largest "
    "bucket is every examiner whose given name sounds like “Ahmed”. Resolution still returns in about "
    "7 ms and it is an admin path, so this is acceptable today. It will not be at ten times the examiner count. "
    "The benchmark deliberately includes a degenerate corpus where blocking collapses to four buckets, so the "
    "cost of that failure (about 20 ms) is known in advance rather than discovered in production. The fix, when "
    "the largest bucket passes roughly 2,000 records, is a compound given+family blocking key - one function.",
    CONTENT_W, WARN, WARN_BG))

# ===========================================================================
# 8. RISK REGISTER (landscape)
# ===========================================================================
story.append(NextPageTemplate("landscape"))
story.append(PageBreak())
story.append(Paragraph("9. Risk register", S["h1"]))
story.append(Paragraph(
    "Every risk in the framework's Section 11 table, plus the ones this implementation surfaced. Status is "
    "Closed only where a test enforces the control.", S["h1sub"]))
story.append(make_table(
    ["ID", "Risk", "Class", "Impact", "Likelihood", "Control", "Status", "Evidence"],
    [list(x) for x in D.RISKS],
    [9 * mm, 52 * mm, 22 * mm, 16 * mm, 18 * mm, 74 * mm, 24 * mm, LAND_W - 215 * mm],
    status_cols=(6,)))

# ===========================================================================
# 9. ROADMAP (landscape)
# ===========================================================================
story.append(PageBreak())
story.append(Paragraph("10. Roadmap", S["h1"]))
story.append(Paragraph(
    "The framework's Phase A-D plan, extended. Phases A-C are complete and measured; Phase D is blocked on "
    "data that does not exist yet, not on engineering.", S["h1sub"]))
story.append(make_table(
    ["Phase", "Work", "Status", "Detail", "Why it matters"],
    [list(x) for x in D.ROADMAP],
    [16 * mm, 42 * mm, 26 * mm, 98 * mm, LAND_W - 182 * mm],
    status_cols=(2,)))
story.append(Paragraph(
    "Table 13. Phases E.3 and E.4 are <i>triggered</i> rather than scheduled: E.3 when the largest examiner "
    "blocking bucket exceeds roughly 2,000 records, which the index reports directly; E.4 only if the "
    "labelled-corpus benchmark shows the vocabulary's residue justifies a semantic adapter.", S["caption"]))

story.append(NextPageTemplate("portrait"))
story.append(PageBreak())

# ===========================================================================
# 10. RECOMMENDATIONS + EVIDENCE
# ===========================================================================
story.append(Paragraph("11. Recommendations", S["h1"]))
story.append(Paragraph("In the order they should be done.", S["h1sub"]))

recs = [
    ("Label a corpus. This is the highest-value next action by a wide margin.",
     "Three to five hundred real recall segments, labelled by a reviewer for examiner, case, question, year and "
     "answer. It unblocks the extraction-precision KPI, supplies training pairs for Fellegi-Sunter EM fitting, "
     "and lets every threshold in the engine be recalibrated against reality instead of against a reference set "
     "of eight pairs. It is a labelling exercise, not an engineering one, and nothing else about content "
     "quality can be settled without it."),
    ("Run the engine against production data before changing anything else.",
     "The thresholds, the vocabulary and the blocking scheme are all configuration. The most likely outcome of "
     "the first real run is a list of vocabulary gaps and a threshold adjustment - both cheap. Discovering "
     "those after building further on top is not."),
    ("Wire the observability events to a real sink and watch four numbers.",
     "Evaluation fallback rate, examiner-resolution ambiguity rate, unmatched-term frequency, and station "
     "creation p95. The first three are content-quality signals that no amount of code review substitutes for; "
     "the fourth confirms the latency claims hold under real I/O."),
    ("Add QTI 3.0 export when institutional adoption becomes the goal.",
     "Not before. It is real work with no benefit to a single-institution deployment, and the domain model "
     "already supports it whenever it is wanted."),
    ("Add OCR as a parser-registry entry, not as a redesign.",
     "The refusal path is correct and should stay. An OCR-backed pdf parser slots in beside the existing ones "
     "and changes nothing downstream, because the text-quality gate will still catch a bad OCR result."),
    ("Consider a semantic adapter only after step 1 quantifies the residue.",
     "If the labelled corpus shows the vocabulary misses five percent of answers, the adapter is not worth its "
     "cost. If it misses thirty, it is. That number does not exist yet, and building the adapter before it does "
     "means never learning whether it was needed."),
]
for i, (title, body) in enumerate(recs, start=1):
    story.append(KeepTogether([
        Paragraph(f"{i}. {title}", S["h3"]),
        Paragraph(body, S["body"]),
    ]))

story.append(Paragraph("11.1 What this engine is, and is not", S["h2"]))
story.append(Paragraph(
    "It is a knowledge engine with an examination runtime attached. Its differentiating asset is the traceable "
    "examiner-case-question graph built from historical recall material, and every design decision that looks "
    "conservative - the two-gate resolver, the review boundary, the refusal to OCR, the refusal to infer an "
    "answer key - protects that asset.",
    S["body"]))
story.append(Paragraph(
    "It is not an exam-day delivery platform and should not become one. Circuits, examiner tablets and "
    "invigilation are a different product with different constraints, and the institutions that need them "
    "already buy them. The right relationship is complementary: this engine produces the validated question "
    "bank, and a delivery platform consumes it - which is precisely the argument for the QTI export in "
    "recommendation four.",
    S["body"]))

story.append(Paragraph("11.2 Evidence index", S["h2"]))
story.append(make_table(
    ["Claim", "Value", "Command"],
    [[e[0], e[1], e[3]] for e in D.EVIDENCE],
    [28 * mm, CONTENT_W - 28 * mm - 42 * mm, 42 * mm],
    mono_cols=(2,)))
story.append(Paragraph(
    "Table 14. Every quantitative claim in this report is reproducible from the accompanying source.",
    S["caption"]))

story.append(PageBreak())
story.append(Paragraph("Sources", S["h1"]))
story.append(Paragraph(
    "Product documentation, standards and research consulted for the comparative analysis.", S["h1sub"]))
story.append(make_table(
    ["Source", "URL"],
    [list(x) for x in D.SOURCES],
    [72 * mm, CONTENT_W - 72 * mm],
    mono_cols=(1,)))

# ===========================================================================
# BUILD
# ===========================================================================
out = Path(__file__).parent / "OSCE_Engine_Study.pdf"
doc = BaseDocTemplate(
    str(out), pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN + 4 * mm,
    title=f"{D.META['title']} - {D.META['subtitle']}",
    author=D.META["author"], subject="Engineering study and competitive analysis",
)

portrait_frame = Frame(MARGIN, MARGIN + 4 * mm, CONTENT_W,
                       PAGE_H - 2 * MARGIN - 4 * mm, id="portrait")
landscape_frame = Frame(MARGIN, MARGIN + 4 * mm, LAND_W,
                        PAGE_W - 2 * MARGIN - 4 * mm, id="landscape")

doc.addPageTemplates([
    PageTemplate(id="cover", frames=[portrait_frame], onPage=cover_page, pagesize=A4),
    PageTemplate(id="portrait", frames=[portrait_frame], onPage=portrait_page, pagesize=A4),
    PageTemplate(id="landscape", frames=[landscape_frame], onPage=landscape_page,
                 pagesize=(PAGE_H, PAGE_W)),
])

doc.build(story)
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
