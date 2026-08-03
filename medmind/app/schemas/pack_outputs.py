from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class Section(BaseModel):
    heading: str
    bullets: List[str]
    clinical_pearl: Optional[str] = None


class StructureAnalysis(BaseModel):
    title: str
    sections: List[Section]
    high_yield_topics: List[str]
    suggested_sources: List[str] = Field(default_factory=list)


class SummaryOutput(BaseModel):
    title: str
    markdown: str
    high_yield_box: List[str]


class KeywordItem(BaseModel):
    term: str
    definition: str
    importance: Literal[1, 2, 3]
    clinical_note: Optional[str] = None


class KeywordsOutput(BaseModel):
    keywords: List[KeywordItem]


class QuizQuestion(BaseModel):
    id: int
    stem: str
    options: dict
    correct: Literal["A", "B", "C", "D"]
    explanation: str
    difficulty: Literal["easy", "medium", "hard"]


class QuizOutput(BaseModel):
    questions: List[QuizQuestion]


class AnkiCard(BaseModel):
    front: str
    back: str
    tags: List[str]
    card_type: Literal["basic", "cloze"] = "basic"


class AnkiOutput(BaseModel):
    deck_name: str
    cards: List[AnkiCard]


class MindMapOutput(BaseModel):
    title: str
    mermaid: str


class SourcesOutput(BaseModel):
    references: List[str]
    disclaimer: str
