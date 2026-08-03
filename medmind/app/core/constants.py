import enum


class Specialty(str, enum.Enum):
    GENERAL_MEDICINE = "general_medicine"
    PHARMACY = "pharmacy"
    DENTISTRY = "dentistry"
    NURSING = "nursing"
    MEDICAL_LABS = "medical_labs"
    OTHER = "other"


SPECIALTY_LABELS = {
    Specialty.GENERAL_MEDICINE: "طب عام",
    Specialty.PHARMACY: "صيدلة",
    Specialty.DENTISTRY: "طب أسنان",
    Specialty.NURSING: "تمريض",
    Specialty.MEDICAL_LABS: "مختبرات",
    Specialty.OTHER: "أخرى",
}


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    PENDING_PAYMENT = "pending_payment"


class PackStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ArtifactType(str, enum.Enum):
    SUMMARY_PDF = "summary_pdf"
    SUMMARY_MD = "summary_md"
    MINDMAP_PNG = "mindmap_png"
    MINDMAP_MMD = "mindmap_mmd"
    KEYWORDS_TXT = "keywords_txt"
    KEYWORDS_JSON = "keywords_json"
    QUIZ_PDF = "quiz_pdf"
    QUIZ_JSON = "quiz_json"
    ANKI_APKG = "anki_apkg"
    SOURCES_MD = "sources_md"
    STUDY_PLAN_JSON = "study_plan_json"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    REFUNDED = "refunded"


class PaymentMethod(str, enum.Enum):
    ZAINCASH = "zaincash"
    BANK_TRANSFER = "bank_transfer"
    QI_CARD = "qi_card"
    AGENT_CODE = "agent_code"
    MANUAL = "manual"


class JobType(str, enum.Enum):
    GENERATE_PACK = "generate_pack"
    DELIVER_PACK = "deliver_pack"
    SEND_QUIZ = "send_quiz"
    SEND_REMINDER = "send_reminder"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    DEAD = "dead"
