"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Pin = {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  origin: string;
  region: string;
  height: number;
  color: string;
  color2?: string;
  pattern?: string;
  insight?: string | null;
  similar_note?: string | null;
  is_new?: boolean;
  likes?: number;
};

type Board = { id: string; title: string; count: number };

type Feed = {
  pins: Pin[];
  boards: Board[];
  trend: {
    whisper: string;
    rising: string[];
    falling?: string[];
    from: string[];
    story?: string;
  };
};

const REGIONS = [
  { id: "all", label: "الكل" },
  { id: "مصر", label: "مصر / دمياط" },
  { id: "تركيا", label: "تركيا" },
];

function Motif({ pattern }: { pattern?: string }) {
  return <div className={`motif ${pattern || "plain"}`} />;
}

export default function MarketWorkspace() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [region, setRegion] = useState("all");
  const [board, setBoard] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Pin | null>(null);
  const [related, setRelated] = useState<Pin[]>([]);
  const [localMatch, setLocalMatch] = useState<{ name: string; note: string } | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem("fios-saved-pins") || "{}"));
    } catch {
      /* ignore */
    }
  }, []);

  async function load(opts?: { region?: string; q?: string }) {
    try {
      const r = opts?.region ?? region;
      const query = opts?.q ?? q;
      const params = new URLSearchParams({ limit: "60" });
      if (r !== "all") params.set("region", r);
      if (query.trim()) params.set("q", query.trim());
      const data = await api<Feed>(`/workspace/market/feed?${params}`);
      setFeed(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التحميل");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function openPin(pin: Pin) {
    setSelected(pin);
    try {
      const data = await api<{
        pin: Pin;
        related: Pin[];
        local_match?: { name: string; note: string } | null;
      }>(`/workspace/market/pins/${encodeURIComponent(pin.id)}`);
      setSelected(data.pin);
      setRelated(data.related || []);
      setLocalMatch(data.local_match || null);
    } catch {
      setRelated([]);
      setLocalMatch(null);
    }
  }

  function toggleSave(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setSaved((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem("fios-saved-pins", JSON.stringify(next));
      return next;
    });
  }

  const pins = useMemo(() => {
    let all = feed?.pins || [];
    if (board === "gold") all = all.filter((p) => /ذهبي|gold/i.test(p.title + p.tags.join(" ")));
    if (board === "damietta") all = all.filter((p) => p.region === "مصر");
    if (board === "turkish") all = all.filter((p) => p.region === "تركيا");
    if (board === "bedroom") all = all.filter((p) => /نوم|bedroom/i.test(p.title + p.tags.join(" ")));
    return all;
  }, [feed, board]);

  return (
    <div className="mk-shell">
      <div className="mk-header">
        <h1>السوق</h1>
        <p>
          تصفّح تصاميم مصر وتركيا كالـ Pinterest. التجميع واكتشاف الترند يحدث في الخلفية — أنت فقط ترى الجمال
          والفرص.
        </p>

        {feed?.trend && (
          <div className="mk-whisper">
            <div>
              <div className="label">همسة هذا الأسبوع</div>
              <div style={{ fontSize: "1.02rem", lineHeight: 1.55 }}>{feed.trend.whisper}</div>
              {feed.trend.story && (
                <div style={{ marginTop: 10, color: "var(--mk-muted)", fontSize: ".9rem", lineHeight: 1.5 }}>
                  {feed.trend.story}
                </div>
              )}
              <div className="mk-rising">
                {feed.trend.rising.map((t) => (
                  <span key={t} className="mk-tag">
                    ↑ {t}
                  </span>
                ))}
                {(feed.trend.falling || []).map((t) => (
                  <span key={t} className="mk-tag down">
                    ↓ {t}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="label">من أين يتحرك السوق</div>
              <div className="mk-rising">
                {feed.trend.from.map((t) => (
                  <span key={t} className="mk-tag">
                    {t}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 16, color: "var(--mk-muted)", fontSize: ".85rem" }}>
                محفوظاتك: {Object.values(saved).filter(Boolean).length} تصميم
              </div>
            </div>
          </div>
        )}

        <div className="mk-toolbar">
          <input
            className="mk-search"
            placeholder="ابحث: كنب ذهبي، غرفة نوم دمياطي، تاج فرنسي..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load({ q })}
          />
          <div className="mk-filters">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                className={region === r.id ? "active" : ""}
                onClick={() => {
                  setRegion(r.id);
                  setBoard(null);
                  load({ region: r.id });
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {(feed?.boards || []).length > 0 && (
          <div className="mk-boards">
            {feed!.boards.map((b) => (
              <button
                key={b.id}
                className={board === b.id ? "active" : ""}
                onClick={() => setBoard(board === b.id ? null : b.id)}
              >
                {b.title} · {b.count}
              </button>
            ))}
          </div>
        )}
        {error && <p style={{ color: "#a33" }}>{error}</p>}
      </div>

      <div className="mk-masonry">
        {pins.map((pin) => (
          <article key={pin.id} className="mk-pin" onClick={() => openPin(pin)}>
            <div
              className="mk-pin-visual"
              style={{
                height: pin.height,
                background: `linear-gradient(155deg, ${pin.color} 0%, ${pin.color2 || "#1a1612"} 95%)`,
              }}
            >
              <Motif pattern={pin.pattern} />
              {pin.is_new && <span className="mk-ribbon">جديد</span>}
              <button className={`mk-save ${saved[pin.id] ? "on" : ""}`} onClick={(e) => toggleSave(pin.id, e)}>
                {saved[pin.id] ? "★" : "☆"}
              </button>
            </div>
            <div className="mk-pin-body">
              <h3>{pin.title}</h3>
              <p className="sub">{pin.subtitle}</p>
              <div className="mk-pin-meta">
                <span>{pin.origin}</span>
                <span>
                  {pin.region}
                  {pin.likes ? ` · ${pin.likes}` : ""}
                </span>
              </div>
              {pin.similar_note && <div className="mk-pin-insight">{pin.similar_note}</div>}
            </div>
          </article>
        ))}
      </div>

      {selected && (
        <div className="mk-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="mk-modal" onClick={(e) => e.stopPropagation()}>
            <div
              className="mk-modal-visual"
              style={{ background: `linear-gradient(155deg, ${selected.color}, ${selected.color2 || "#1a1612"})` }}
            >
              <Motif pattern={selected.pattern} />
            </div>
            <div className="mk-modal-body">
              <h2>{selected.title}</h2>
              <p style={{ color: "var(--mk-muted)", marginTop: 0 }}>{selected.subtitle}</p>
              {selected.insight && <p>{selected.insight}</p>}
              {selected.similar_note && <p style={{ color: "var(--mk-accent)" }}>{selected.similar_note}</p>}
              {localMatch && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    background: "rgba(139,90,43,.08)",
                    lineHeight: 1.5,
                  }}
                >
                  <strong>في ورشك:</strong> {localMatch.note}
                </div>
              )}
              <div className="mk-rising" style={{ marginTop: 12 }}>
                {selected.tags.map((t) => (
                  <span key={t} className="mk-tag">
                    {t}
                  </span>
                ))}
              </div>
              {related.length > 0 && (
                <>
                  <div className="label" style={{ marginTop: 18, fontSize: ".8rem", fontWeight: 700, color: "var(--mk-accent)" }}>
                    قريب من هذا التصميم
                  </div>
                  <div className="related-grid">
                    {related.map((r) => (
                      <div key={r.id} className="related-mini" onClick={() => openPin(r)}>
                        <div className="v" style={{ background: `linear-gradient(145deg, ${r.color}, ${r.color2 || "#222"})` }} />
                        <div className="t">{r.title}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ marginTop: 20, displayAlign: "left", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn ghost" style={{ borderColor: "#ddd", color: "#222" }} onClick={() => toggleSave(selected.id)}>
                  {saved[selected.id] ? "محفوظ ★" : "حفظ ☆"}
                </button>
                <button className="btn ghost" style={{ borderColor: "#ddd", color: "#222" }} onClick={() => setSelected(null)}>
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
