import { useState, useRef, useEffect } from "react";
import { transcribeAudio, getJournalFeedback } from "./api";

const STORAGE_KEY = "jt_journal_entries";
function loadEntries() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveEntry(entry) { const e = loadEntries(); e.unshift(entry); localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); }
function formatDate(iso) { return new Date(iso).toLocaleDateString("ja-JP", { year:"numeric", month:"2-digit", day:"2-digit", weekday:"short" }); }
function formatTime(iso) { return new Date(iso).toLocaleTimeString("ja-JP", { hour:"2-digit", minute:"2-digit" }); }

function calcStreak(entries) {
  if (!entries.length) return 0;
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  let check = new Date(today);
  for (let i = 0; i < 365; i++) {
    const found = entries.some(e => {
      const d = new Date(e.date); d.setHours(0,0,0,0);
      return d.getTime() === check.getTime();
    });
    if (found) { streak++; check.setDate(check.getDate() - 1); }
    else break;
  }
  return streak;
}

// ── RECORD VIEW ────────────────────────────────────────────
function RecordView({ onComplete, entries }) {
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(null); // "voice" | "text"
  const timerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const streak = calcStreak(entries);

  const startRecording = async () => {
    setError(""); setMode("voice");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(); mediaRecorderRef.current = mr;
      setPhase("recording"); setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch { setError("マイクのアクセスが拒否されました。"); setMode(null); }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current); setPhase("transcribing");
    const mr = mediaRecorderRef.current;
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      mr.stream.getTracks().forEach((t) => t.stop());
      try { const text = await transcribeAudio(blob); setTranscript(text); setPhase("editing"); }
      catch (e) { setError("音声変換エラー: " + e.message); setPhase("idle"); setMode(null); }
    };
    mr.stop();
  };

  const analyze = async () => {
    if (!transcript.trim()) return;
    setPhase("analyzing"); setError("");
    try {
      const past = loadEntries().slice(0, 5);
      const fb = await getJournalFeedback(transcript, past);
      setFeedback(fb); setPhase("done");
    } catch (e) { setError("Claude APIエラー: " + e.message); setPhase("editing"); }
  };

  const save = () => {
    saveEntry({ id: Date.now(), date: new Date().toISOString(), text: transcript, feedback });
    onComplete();
  };

  const reset = () => { setPhase("idle"); setTranscript(""); setFeedback(""); setMode(null); setError(""); };

  return (
    <div style={s.recordWrap}>
      {/* STREAK */}
      <div style={s.streakBar}>
        <span style={s.streakFire}>🔥</span>
        <span style={s.streakNum}>{streak}</span>
        <span style={s.streakLabel}>日連続</span>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {/* IDLE */}
      {phase === "idle" && (
        <div style={s.idleContent}>
          {/* マイクボタン */}
          <div style={s.micSection}>
            <button style={s.bigMicBtn} onClick={startRecording}>
              <MicIcon size={56} />
            </button>
            <p style={s.micLabel}>話す</p>
          </div>

          {/* 書くボタン */}
          <button style={s.writeBtn} onClick={() => { setMode("text"); setPhase("editing"); }}>
            <PenIcon size={20} />
            <span>書く</span>
          </button>
        </div>
      )}

      {/* RECORDING */}
      {phase === "recording" && (
        <div style={s.recordingContent}>
          <div style={s.pulseRing}>
            <div style={s.pulseRingInner} />
            <button style={s.bigMicBtnActive} onClick={stopRecording}>
              <MicIcon size={56} color="#fff" />
            </button>
          </div>
          <p style={s.timerText}>{fmt(seconds)}</p>
          <p style={s.recordingHint}>タップして停止</p>
        </div>
      )}

      {/* TRANSCRIBING */}
      {phase === "transcribing" && (
        <div style={s.loadingContent}>
          <Spinner />
          <p style={s.loadingText}>音声を変換中...</p>
        </div>
      )}

      {/* EDITING */}
      {phase === "editing" && (
        <div style={s.editContent}>
          <div style={s.editHeader}>
            <button style={s.backBtn} onClick={reset}>← 戻る</button>
            <p style={s.editTitle}>{mode === "voice" ? "内容を確認" : "今日の記録"}</p>
          </div>
          <textarea
            style={s.bigTextarea}
            placeholder="今日の気持ちや出来事を書いてください..."
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            autoFocus={mode === "text"}
          />
          <button style={s.analyzeBtn} onClick={analyze} disabled={!transcript.trim()}>
            Claudeに分析してもらう →
          </button>
        </div>
      )}

      {/* ANALYZING */}
      {phase === "analyzing" && (
        <div style={s.loadingContent}>
          <Spinner />
          <p style={s.loadingText}>Claudeが分析中...</p>
        </div>
      )}

      {/* DONE */}
      {phase === "done" && (
        <div style={s.doneContent}>
          <div style={s.feedbackCard}>
            <p style={s.feedbackTitle}>AIフィードバック</p>
            <p style={s.feedbackBody}>{feedback}</p>
          </div>
          <div style={s.entryCard}>
            <p style={s.entryBody}>{transcript}</p>
          </div>
          <div style={s.doneButtons}>
            <button style={s.editAgainBtn} onClick={() => setPhase("editing")}>修正</button>
            <button style={s.saveBtn} onClick={save}>保存する ✓</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── HISTORY VIEW ────────────────────────────────────────────
function HistoryView({ entries, onSelect }) {
  if (!entries.length) return (
    <div style={s.emptyWrap}>
      <p style={s.emptyIcon}>📖</p>
      <p style={s.emptyText}>まだ記録がありません</p>
    </div>
  );
  return (
    <div style={s.historyWrap}>
      <p style={s.historyTitle}>{entries.length}件の記録</p>
      {entries.map((e) => (
        <button key={e.id} style={s.historyCard} onClick={() => onSelect(e)}>
          <div style={s.historyCardTop}>
            <span style={s.historyDate}>{formatDate(e.date)}</span>
            <span style={s.historyTime}>{formatTime(e.date)}</span>
          </div>
          <p style={s.historySnippet}>{e.text.slice(0,80)}{e.text.length > 80 ? "…" : ""}</p>
        </button>
      ))}
    </div>
  );
}

// ── DETAIL VIEW ────────────────────────────────────────────
function DetailView({ entry, onBack }) {
  return (
    <div style={s.detailWrap}>
      <button style={s.backBtn} onClick={onBack}>← 戻る</button>
      <p style={s.detailDate}>{formatDate(entry.date)} {formatTime(entry.date)}</p>
      <div style={s.detailCard}>
        <p style={s.detailLabel}>記録</p>
        <p style={s.detailText}>{entry.text}</p>
      </div>
      {entry.feedback && (
        <div style={{ ...s.detailCard, borderColor: "#111" }}>
          <p style={s.detailLabel}>AIフィードバック</p>
          <p style={s.detailText}>{entry.feedback}</p>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("record");
  const [entries, setEntries] = useState(loadEntries);
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleComplete = () => {
    setEntries(loadEntries());
    setSaved(true);
    setTimeout(() => { setSaved(false); setTab("history"); }, 1800);
  };

  return (
    <div style={s.app}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; padding: 0; background: #fafaf8; }
        @keyframes pulse { 0%,100% { transform: scale(1); opacity:0.6; } 50% { transform: scale(1.15); opacity:0.2; } }
        @keyframes bounce { 0% { transform: translateY(0); } 100% { transform: translateY(-8px); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        textarea:focus { outline: none; border-color: #111 !important; }
      `}</style>

      {saved && <div style={s.toast}>保存しました ✓</div>}

      <main style={s.main}>
        {selected ? (
          <DetailView entry={selected} onBack={() => setSelected(null)} />
        ) : tab === "record" ? (
          <RecordView onComplete={handleComplete} entries={entries} />
        ) : (
          <HistoryView entries={entries} onSelect={setSelected} />
        )}
      </main>

      {!selected && (
        <nav style={s.nav}>
          <button style={{ ...s.navBtn, ...(tab === "record" ? s.navActive : {}) }} onClick={() => setTab("record")}>
            <MicIcon size={20} color={tab === "record" ? "#111" : "#bbb"} />
            <span style={s.navLabel}>記録</span>
          </button>
          <button style={{ ...s.navBtn, ...(tab === "history" ? s.navActive : {}) }} onClick={() => setTab("history")}>
            <HistoryIcon size={20} color={tab === "history" ? "#111" : "#bbb"} />
            <span style={s.navLabel}>履歴{entries.length > 0 ? ` (${entries.length})` : ""}</span>
          </button>
        </nav>
      )}
    </div>
  );
}

// ── ICONS ──────────────────────────────────────────────────
function MicIcon({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
function PenIcon({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function HistoryIcon({ size = 24, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="15" y2="18" />
    </svg>
  );
}
function Spinner() {
  return (
    <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
      {[0,1,2].map((i) => (
        <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"#111",
          animation:`bounce 0.5s ${i*0.15}s infinite alternate` }} />
      ))}
    </div>
  );
}

// ── STYLES ─────────────────────────────────────────────────
const s = {
  app: {
    fontFamily: "'Georgia', 'Hiragino Mincho ProN', serif",
    background: "#fafaf8",
    height: "100dvh",
    width: "100vw",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "fixed",
    top: 0, left: 0,
  },
  main: {
    flex: 1,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 72,
  },

  // RECORD
  recordWrap: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    padding: "0 24px",
    paddingTop: "env(safe-area-inset-top, 16px)",
  },
  streakBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingTop: 20,
    paddingBottom: 8,
  },
  streakFire: { fontSize: 22 },
  streakNum: { fontSize: 28, fontWeight: 700, color: "#111", letterSpacing: "-1px" },
  streakLabel: { fontSize: 13, color: "#888", letterSpacing: "0.05em" },

  idleContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 40,
    animation: "fadeIn 0.4s ease",
  },
  micSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  bigMicBtn: {
    width: 160,
    height: 160,
    borderRadius: "50%",
    border: "2px solid #111",
    background: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#111",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    transition: "transform 0.15s, box-shadow 0.15s",
  },
  micLabel: {
    fontSize: 14,
    color: "#888",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  writeBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#fff",
    border: "1.5px solid #ddd",
    borderRadius: 12,
    padding: "14px 32px",
    fontSize: 16,
    color: "#444",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.05em",
  },

  // RECORDING
  recordingContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    animation: "fadeIn 0.3s ease",
  },
  pulseRing: {
    position: "relative",
    width: 200,
    height: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRingInner: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    background: "rgba(0,0,0,0.08)",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  bigMicBtnActive: {
    width: 160,
    height: 160,
    borderRadius: "50%",
    border: "none",
    background: "#111",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    zIndex: 1,
  },
  timerText: {
    fontSize: 52,
    fontWeight: 300,
    letterSpacing: "0.05em",
    color: "#111",
  },
  recordingHint: {
    fontSize: 13,
    color: "#aaa",
    letterSpacing: "0.05em",
  },

  // LOADING
  loadingContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  loadingText: {
    fontSize: 14,
    color: "#888",
    letterSpacing: "0.05em",
  },

  // EDITING
  editContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingTop: 16,
    animation: "fadeIn 0.3s ease",
  },
  editHeader: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  editTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: "#111",
  },
  bigTextarea: {
    flex: 1,
    border: "1px solid #e0e0dc",
    borderRadius: 12,
    padding: "16px",
    fontSize: 16,
    lineHeight: 1.8,
    resize: "none",
    fontFamily: "inherit",
    color: "#111",
    background: "#fff",
    width: "100%",
    minHeight: 200,
  },
  analyzeBtn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "16px",
    fontSize: 16,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.03em",
    width: "100%",
    marginBottom: 8,
  },

  // DONE
  doneContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingTop: 16,
    overflowY: "auto",
    animation: "fadeIn 0.4s ease",
  },
  feedbackCard: {
    border: "1.5px solid #111",
    borderRadius: 12,
    padding: 16,
    background: "#fff",
  },
  feedbackTitle: {
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#888",
    marginBottom: 10,
  },
  feedbackBody: {
    fontSize: 14,
    lineHeight: 1.8,
    color: "#222",
    whiteSpace: "pre-line",
  },
  entryCard: {
    background: "#f5f5f2",
    borderRadius: 12,
    padding: 16,
  },
  entryBody: {
    fontSize: 14,
    lineHeight: 1.7,
    color: "#555",
  },
  doneButtons: {
    display: "flex",
    gap: 12,
    marginBottom: 8,
  },
  editAgainBtn: {
    flex: 1,
    background: "#fff",
    border: "1.5px solid #ddd",
    borderRadius: 12,
    padding: "14px",
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
    color: "#666",
  },
  saveBtn: {
    flex: 2,
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "14px",
    fontSize: 15,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  // HISTORY
  historyWrap: {
    padding: "24px 20px",
    paddingTop: "calc(env(safe-area-inset-top, 16px) + 16px)",
  },
  historyTitle: {
    fontSize: 13,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#888",
    marginBottom: 16,
  },
  historyCard: {
    width: "100%",
    background: "#fff",
    border: "1px solid #e8e8e4",
    borderRadius: 12,
    padding: "14px 16px",
    marginBottom: 10,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
  },
  historyCardTop: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  historyDate: { fontSize: 12, color: "#111", fontWeight: 600 },
  historyTime: { fontSize: 11, color: "#aaa" },
  historySnippet: { fontSize: 13, color: "#666", lineHeight: 1.6 },

  // DETAIL
  detailWrap: {
    padding: "24px 20px",
    paddingTop: "calc(env(safe-area-inset-top, 16px) + 16px)",
  },
  detailDate: { fontSize: 13, color: "#aaa", marginBottom: 20, marginTop: 8 },
  detailCard: {
    border: "1px solid #e8e8e4",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    background: "#fff",
  },
  detailLabel: {
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#bbb",
    marginBottom: 10,
  },
  detailText: { fontSize: 14, lineHeight: 1.8, color: "#333", whiteSpace: "pre-line" },

  // SHARED
  backBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    color: "#888",
    padding: 0,
    fontFamily: "inherit",
  },
  error: {
    background: "#fff3f3",
    border: "1px solid #ffcdd2",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    color: "#c62828",
    marginTop: 8,
  },
  emptyWrap: {
    height: "60vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 16, color: "#888" },

  // NAV
  nav: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    background: "#fafaf8",
    borderTop: "1px solid #e8e8e4",
    display: "flex",
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
  },
  navBtn: {
    flex: 1,
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "10px 0 8px",
    fontFamily: "inherit",
    color: "#bbb",
  },
  navActive: { color: "#111" },
  navLabel: {
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "inherit",
  },

  // TOAST
  toast: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 16px)",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#111",
    color: "#fff",
    padding: "10px 24px",
    borderRadius: 20,
    fontSize: 13,
    zIndex: 100,
    letterSpacing: "0.05em",
    animation: "fadeIn 0.3s ease",
  },
};
