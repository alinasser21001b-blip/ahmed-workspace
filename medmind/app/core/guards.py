import re

MEDICAL_QUESTION_PATTERNS = [
    r"\bwhat is\b",
    r"\bhow to treat\b",
    r"\bdiagnos",
    r"\bsymptom",
    r"\bdose\b",
    r"\bmedication for\b",
    r"\bpatient presents\b",
    r"ما هو\b",
    r"ما هي\b",
    r"كيف أعالج",
    r"كيف نعالج",
    r"تشخيص",
    r"أعراض",
    r"جرعة",
    r"علاج\b",
    r"مريض\b",
    r"حالة\b",
]

COMPILED_MEDICAL_PATTERNS = [re.compile(p, re.IGNORECASE) for p in MEDICAL_QUESTION_PATTERNS]


def looks_like_medical_question(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned or cleaned.startswith("/"):
        return False
    if len(cleaned) < 8:
        return False
    question_mark = "?" in cleaned or "؟" in cleaned
    matched = sum(1 for p in COMPILED_MEDICAL_PATTERNS if p.search(cleaned))
    return question_mark and matched >= 1 or matched >= 2
