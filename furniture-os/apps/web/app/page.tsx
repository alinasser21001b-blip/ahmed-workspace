"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Decision = {
  id: string;
  label: string;
  type?: string;
  memory_note?: string | null;
  waiting_hours?: number | null;
};

type Conversation = {
  id: string;
  name: string;
  avatar_seed: string;
  role?: string;
  role_icon?: string;
  last_message: string;
  last_at?: string | null;
  urgency: string;
  pending_count: number;
  pending_decisions: Decision[];
  summary: string;
  status_line?: string;
  stage?: string | null;
  waiting_hours?: number | null;
  memory_note?: string | null;
  media_count: number;
  media_insights: string[];
  progress?: { label: string; state: string }[];
  sample_previews?: { id: string; swatch?: { from: string; to: string }; insight?: string }[];
};

type Message = {
  id: string;
  from: string;
  is_mine: boolean;
  text: string;
  at?: string | null;
  day_separator?: string | null;
  media: {
    id: string;
    kind: string;
    insight?: string | null;
    transcript?: string | null;
    swatch?: { from: string; to: string };
  }[];
};

type Brief = {
  waiting_on_you: number;
  headline: string;
  subline?: string;
  focus?: { id: string; name: string; reason: string }[];
};

type Related = {
  id: string;
  title: string;
  color: string;
  color2?: string;
};

const FILTERS = [
  { id: "all", label: "الكل" },
  { id: "needs_you", label: "يحتاجك" },
  { id: "waiting", label: "متأخر" },
  { id: "media", label: "فيه صور" },
];

function formatTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ar-EG", { hour: "2-digit", minute: "2-digit" });
}

function avatarColor(seed: string) {
  const colors = ["#6a8f7b", "#8a7349", "#5c6b8a", "#8a5c5c", "#5a7a6a", "#7a6a8a", "#9a7b4f"];
  return colors[(parseInt(seed.slice(0, 2), 16) || 0) % colors.length];
}

export default function WhatsAppWorkspace() {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [related, setRelated] = useState<Related[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadList(mode = filter) {
    try {
      const [b, c] = await Promise.all([
        api<Brief>("/workspace/brief"),
        api<{ items: Conversation[] }>(`/workspace/conversations?filter=${mode}`),
      ]);
      setBrief(b);
      setItems(c.items);
      setError(null);
      if (!selectedId && c.items[0]) openChat(c.items[0].id, c.items[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التحميل");
    }
  }

  async function openChat(id: string, preview?: Conversation) {
    setSelectedId(id);
    setMobileShowThread(true);
    if (preview) setSelected(preview);
    try {
      const data = await api<{
        conversation: Conversation;
        messages: Message[];
        related_designs?: Related[];
        composer_hints?: string[];
      }>(`/workspace/conversations/${encodeURIComponent(id)}`);
      setSelected(data.conversation);
      setMessages(data.messages);
      setRelated(data.related_designs || []);
      setHints(data.composer_hints || []);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر فتح المحادثة");
    }
  }

  async function resolve(decisionId: string, resolution: string) {
    setBusy(decisionId);
    try {
      await api(`/production/decisions/${decisionId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution }),
      });
      await loadList();
      if (selectedId) await openChat(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر حفظ القرار");
    } finally {
      setBusy(null);
    }
  }

  function sendDraft() {
    const text = draft.trim();
    if (!text || !selectedId) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        from: "Owner",
        is_mine: true,
        text,
        at: new Date().toISOString(),
        media: [],
      },
    ]);
    setDraft("");
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 30);
  }

  useEffect(() => {
    loadList("all");
  }, []);

  useEffect(() => {
    loadList(filter);
  }, [filter]);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return items;
    return items.filter(
      (c) =>
        c.name.includes(needle) ||
        (c.summary || "").includes(needle) ||
        (c.status_line || "").includes(needle) ||
        (c.role || "").includes(needle)
    );
  }, [items, q]);

  return (
    <div className="wa-shell">
      <aside className={`wa-list ${mobileShowThread ? "hide-mobile" : ""}`}>
        <div className="wa-list-header">
          <h1>المحادثات</h1>
          {brief && (
            <div className={`wa-brief ${brief.waiting_on_you ? "urgent" : ""}`}>
              <div className="h">{brief.headline}</div>
              {brief.subline && <div className="s">{brief.subline}</div>}
              {(brief.focus || []).length > 0 && (
                <div className="wa-focus">
                  {brief.focus!.map((f) => (
                    <button key={f.id} onClick={() => openChat(f.id)}>
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="wa-filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        <input className="wa-search" placeholder="ابحث باسم الورشة أو الموضوع..." value={q} onChange={(e) => setQ(e.target.value)} />
        {error && <div style={{ padding: 12, color: "#ffb4aa", fontSize: 14 }}>{error}</div>}

        <div className="wa-chats">
          {filtered.map((c) => (
            <div key={c.id} className={`wa-chat-item ${selectedId === c.id ? "active" : ""}`} onClick={() => openChat(c.id, c)}>
              <div className="wa-avatar" style={{ background: avatarColor(c.avatar_seed) }}>
                {(c.name || "?").slice(0, 1)}
                {c.pending_count > 0 && <span className="dot" />}
              </div>
              <div className="wa-chat-main">
                <div className="wa-chat-top">
                  <div className="wa-name">{c.name}</div>
                  <div className="wa-time" style={{ color: c.urgency === "high" ? "var(--wa-accent)" : undefined }}>
                    {formatTime(c.last_at)}
                  </div>
                </div>
                <div className="wa-role">
                  {c.role_icon} {c.role}
                  {c.stage ? ` · ${c.stage}` : ""}
                </div>
                <div className="wa-preview">{c.status_line || c.summary || c.last_message}</div>
                <div className="wa-enrich">
                  {c.pending_count > 0 && <span className="chip urgent">{c.pending_count} بانتظارك</span>}
                  {!!c.waiting_hours && c.waiting_hours >= 3 && (
                    <span className="chip warn">منذ {Math.round(c.waiting_hours)}س</span>
                  )}
                  {c.media_count > 0 && <span className="chip">{c.media_count} مرفقات</span>}
                  {c.memory_note && <span className="chip urgent">تذكير ذوقك</span>}
                </div>
              </div>
              {c.pending_count > 0 && <div className="wa-badge">{c.pending_count}</div>}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 28, color: "var(--wa-muted)", textAlign: "center", lineHeight: 1.6 }}>
              لا محادثات في هذا التصنيف.
              <br />
              جرّب «الكل» أو استورد محادثات واتساب.
            </div>
          )}
        </div>
      </aside>

      <section className={`wa-thread ${!mobileShowThread ? "hide-mobile" : ""}`}>
        {!selected ? (
          <div className="wa-thread-empty">
            <div className="hero">💬</div>
            <div style={{ fontWeight: 700, color: "var(--wa-text)", marginBottom: 8 }}>مساحة واتساب الإنتاج</div>
            اختر ورشة من القائمة. الملخص والقرارات تظهر فوق المحادثة دون أن تغيّر طريقة عملك.
          </div>
        ) : (
          <>
            <div className="wa-thread-header">
              <button className="btn ghost wa-back-mobile" onClick={() => setMobileShowThread(false)}>
                رجوع
              </button>
              <div className="wa-avatar" style={{ width: 42, height: 42, background: avatarColor(selected.avatar_seed || "aa") }}>
                {(selected.name || "?").slice(0, 1)}
              </div>
              <div style={{ flex: 1 }}>
                <h2>{selected.name}</h2>
                <div className="meta">
                  {selected.role_icon} {selected.role}
                  {selected.stage ? ` · المرحلة: ${selected.stage}` : ""}
                  {selected.message_count ? ` · ${selected.message_count} رسالة` : ""}
                </div>
              </div>
            </div>

            <div className="wa-context">
              <div className="wa-card">
                <h3>ماذا يحدث الآن</h3>
                <p>{selected.status_line || selected.summary}</p>
                {selected.memory_note && <div className="memory-note">{selected.memory_note}</div>}
                {(selected.progress || []).length > 0 && (
                  <div className="progress">
                    {selected.progress!.map((s) => (
                      <span key={s.label} className={s.state}>
                        {s.label}
                      </span>
                    ))}
                  </div>
                )}
                {(selected.sample_previews || []).length > 0 && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    {selected.sample_previews!.map((p) => (
                      <div
                        key={p.id}
                        title={p.insight || ""}
                        style={{
                          width: 54,
                          height: 54,
                          borderRadius: 10,
                          background: `linear-gradient(145deg, ${p.swatch?.from || "#8a7349"}, ${p.swatch?.to || "#1a1612"})`,
                        }}
                      />
                    ))}
                  </div>
                )}
                {(selected.pending_decisions || []).map((d) => (
                  <div key={d.id} className="wa-decision">
                    <div>
                      <div className="label">{d.label}</div>
                      {d.memory_note && <div className="memory-note">{d.memory_note}</div>}
                    </div>
                    <div className="actions">
                      <button className="btn approve" disabled={busy === d.id} onClick={() => resolve(d.id, "approve")}>
                        موافقة
                      </button>
                      <button className="btn reject" disabled={busy === d.id} onClick={() => resolve(d.id, "reject")}>
                        رفض
                      </button>
                      <button className="btn ghost" disabled={busy === d.id} onClick={() => resolve(d.id, "defer")}>
                        لاحقاً
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="wa-messages">
              {messages.map((m) => (
                <div key={m.id} style={{ display: "contents" }}>
                  {m.day_separator && <div className="day-sep">{m.day_separator}</div>}
                  <div className={`bubble ${m.is_mine ? "mine" : "theirs"}`}>
                    {!m.is_mine && <div className="who">{m.from}</div>}
                    {m.text && <div>{m.text}</div>}
                    {m.media.map((med) =>
                      med.kind === "audio" || med.transcript ? (
                        <div key={med.id} className="voice-note">
                          <span>🎤</span>
                          <span>{med.transcript || "رسالة صوتية"}</span>
                        </div>
                      ) : (
                        <div key={med.id} className="media-card">
                          <div
                            className="media-swatch"
                            style={{
                              background: `linear-gradient(145deg, ${med.swatch?.from || "#8a7349"}, ${med.swatch?.to || "#1a1612"})`,
                            }}
                          />
                          {med.insight && <div className="media-insight">📷 {med.insight}</div>}
                        </div>
                      )
                    )}
                    <span className="when">{formatTime(m.at)}</span>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {related.length > 0 && (
              <div className="related-strip">
                <h4>تصاميم قريبة في السوق — للمقارنة السريعة</h4>
                <div className="related-row">
                  {related.map((r) => (
                    <div
                      key={r.id}
                      className="related-card"
                      style={{ background: `linear-gradient(145deg, ${r.color}, ${r.color2 || "#1a1612"})` }}
                      onClick={() => router.push("/market")}
                    >
                      {r.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="wa-composer">
              <div className="hint-row">
                {hints.map((h) => (
                  <button key={h} onClick={() => setDraft(h)}>
                    {h}
                  </button>
                ))}
              </div>
              <div className="composer-row">
                <textarea
                  rows={1}
                  placeholder="اكتب ردّاً كما في واتساب..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendDraft();
                    }
                  }}
                />
                <button className="send" onClick={sendDraft} aria-label="إرسال">
                  ↑
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
