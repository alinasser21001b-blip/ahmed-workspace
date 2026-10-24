// Vocabulary shared by the Worker and the web app. Arabic labels live here so
// the API and the interface never name the same state differently.

export const ROLES = ["owner", "exec", "account_manager", "photographer"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ["new", "acknowledged", "in_progress", "in_review", "changes_requested", "done", "cancelled"] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const OPEN_STATUSES: TaskStatus[] = ["new", "acknowledged", "in_progress", "in_review", "changes_requested"];
// Statuses in which the assignee still owes work, so a passed due date means late.
export const WORKING_STATUSES: TaskStatus[] = ["new", "acknowledged", "in_progress", "changes_requested"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: "جديدة",
  acknowledged: "مستلمة",
  in_progress: "قيد التنفيذ",
  in_review: "بانتظار المراجعة",
  changes_requested: "تعديلات مطلوبة",
  done: "مكتملة",
  cancelled: "ملغاة",
};

export const PRIORITIES = ["normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { normal: "عادية", high: "مرتفعة", urgent: "عاجلة" };

export const BLOCKER_KINDS = ["internal", "client_wait", "clarification"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];
export const BLOCKER_LABEL: Record<BlockerKind, string> = {
  internal: "عائق داخلي",
  client_wait: "بانتظار العميل",
  clarification: "طلب توضيح",
};

export const TEMPLATES = {
  shoot_request: { label: "طلب تصوير", acceptance: "عدد اللقطات والمقاسات المطلوبة واضح، والمواد مرفوعة في المجلد المتفق عليه." },
  footage_delivery: { label: "تسليم مواد مصورة", acceptance: "المواد كاملة في المجلد، مع عدد الملفات وأي نقص مكتوب." },
  shoot_scheduling: { label: "تنسيق موعد تصوير", acceptance: "موعد مؤكد مع العميل، ومحجوز في تقويم حسين." },
  content_followup: { label: "متابعة محتوى أو حملة", acceptance: "خطة أو منشور جاهز للمراجعة برابط واضح." },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

export const ACTION_LABEL = {
  ack: "استلمت",
  clarify: "أحتاج توضيحاً",
  start: "بدأت",
  block: "يوجد عائق",
  propose_due: "أقترح موعداً",
  submit: "سلّمت للمراجعة",
  approve: "اعتماد وإكمال",
  request_changes: "طلب تعديل",
} as const;
