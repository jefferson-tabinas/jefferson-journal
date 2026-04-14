import { useState, useRef } from "react";
import { transcribeAudio, getJournalFeedback } from "./api";

const STORAGE_KEY = "jt_journal_entries";
function loadEntries() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } }
function saveEntry(entry) { const e = loadEntries(); e.unshift(entry); localStorage.setItem(STORAGE_KEY, JSON.stringify(e)); }
function formatDate(iso) { return new Date(iso).toLocaleDateString("ja-JP", { year:"numeric",month:"2-digit",day:"2-digit",weekday:"short" }); }
function formatTime(iso) { return new Date(iso).toLocaleTimeString("ja-JP", { hour:"2-digit",minute:"2-digit" }); }

export default function App() {
  const [tab, setTab] = useState("record");
  const [entries, setEntries] = useState(loadEntries);
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(false);
  const handleComplete = () => { setEntries(loadEntries()); setSaved(true); setTimeout(() => { setSaved(false); setTab("history"); }, 1800); };
  return (
    <div style={s.app}>
      <header style={s.header}><span style={s.logo}>JT Journal</span><span style={s.logoSub}>by Jefferson Tabinas</span></header>
      {saved && <div style={s.toast}>保存しました ✓</div>}
      <main style={s.main}>
        {selected ? <DetailView entry={selected} onBack={() => setSelected(null)}/> :
         tab === "record" ? <RecordView onComplete={handleComplete}/> :
         <HistoryView entries={entries} onSelect={setSelected}/>}
      </main>
      {!selected && <nav style={s.nav}>
        <button style={{...s.navBtn,...(tab==="record"?s.navActive:{})}} onClick={() => setTab("record")}><span style={s.navIcon}>○</span><span style={s.navLabel}>記録</span></button>
        <button style={{...s.navBtn,...(tab==="history"?s.navActive:{})}} onClick={() => setTab("history")}><span style={s.navIcon}>≡</span><span style={s.navLabel}>履歴{entries.length > 0 ? ` (${entries.length})` : ""}</span></button>
      </nav>}
    </div>
  );
}

function RecordView({ onComplete }) {
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(); mediaRecorderRef.current = mr;
      setPhase("recording"); setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch { setError("マイクのアクセスが拒否されました。"); }
  };
  const stopRecording = () => {
    clearInterval(timerRef.current); setPhase("transcribing");
    const mr = mediaRecorderRef.current;
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      mr.stream.getTracks().forEach((t) => t.stop());
      try { const text = await transcribeAudio(blob); setTranscript(text); setPhase("editing"); }
      catch (e) { setError("音声変換エラー: " + e.message); setPhase("idle"); }
    };
    mr.stop();
  };
  const analyze = async () => {
    if (!transcript.trim()) return;
    setPhase("analyzing"); setError("");
    try { const fb = await getJournalFeedback(transcript, loadEntries().slice(0,5)); setFeedback(fb); setPhase("done"); }
    catch (e) { setError("Claude APIエラー: " + e.message); setPhase("editing"); }
  };
  const save = () => { saveEntry({ id: Date.now(), date: new Date().toISOString(), text: transcript, feedback }); onComplete(); };
  return (
    <div style={s.view}>
      {error && <div style={s.error}>{error}</div>}
      {phase === "idle" && <div style={s.center}>
        <p style={s.label}>今日の記録</p>
        <button style={s.micBtn} onClick={startRecording}><MicIcon size={32}/></button>
        <p style={s.hint}>タップして話す</p>
        <div style={s.divider}/>
        <textarea style={s.textarea} placeholder="またはここに直接入力..." value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5}/>
        {transcript.trim() && <button style={s.primaryBtn} onClick={analyze}>分析する →</button>}
      </div>}
      {phase === "recording" && <div style={s.center}>
        <div style={s.recDot}/><p style={s.timer}>{fmt(seconds)}</p>
        <p style={s.hint}>話してください...</p>
        <button style={s.stopBtn} onClick={stopRecording}>■ 停止</button>
      </div>}
      {(phase === "transcribing" || phase === "analyzing") && <div style={s.center}>
        <Spinner/><p style={s.hint}>{phase === "transcribing" ? "音声変換中..." : "Claudeが分析中..."}</p>
      </div>}
      {phase === "editing" && <div style={s.editWrap}>
        <p style={s.label}>内容を確認・修正</p>
        <textarea style={{...s.textarea,minHeight:160}} value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={7}/>
        <div style={s.row}>
          <button style={s.ghostBtn} onClick={() => { setTranscript(""); setPhase("idle"); }}>やり直す</button>
          <button style={s.primaryBtn} onClick={analyze}>分析する →</button>
        </div>
      </div>}
      {phase === "done" && <div style={s.editWrap}>
        <div style={s.feedbackBox}><p style={s.feedbackLabel}>AI フィードバック</p><p style={s.feedbackText}>{feedback}</p></div>
        <div style={s.entryPreview}><p style={s.entryText}>{transcript}</p></div>
        <div style={s.row}>
          <button style={s.ghostBtn} onClick={() => setPhase("editing")}>修正する</button>
          <button style={s.primaryBtn} onClick={save}>保存する ✓</button>
        </div>
      </div>}
    </div>
  );
}

function HistoryView({ entries, onSelect }) {
  if (!entries.length) return <div style={s.emptyWrap}><p style={{fontSize:40,color:"#ddd",margin:0}}>○</p><p style={{fontSize:16,color:"#888",margin:0}}>まだ記録がありません</p></div>;
  return <div style={s.view}><p style={s.label}>{entries.length}件の記録</p>{entries.map((e) => (
    <button key={e.id} style={s.entryCard} onClick={() => onSelect(e)}>
      <div style={s.entryCardTop}><span style={s.entryDate}>{formatDate(e.date)}</span><span style={s.entryTime}>{formatTime(e.date)}</span></div>
      <p style={s.entrySnippet}>{e.text.slice(0,80)}{e.text.length>80?"…":""}</p>
    </button>
  ))}</div>;
}

function DetailView({ entry, onBack }) {
  return <div style={s.view}>
    <button style={s.backBtn} onClick={onBack}>← 戻る</button>
    <p style={{fontSize:13,color:"#aaa",marginBottom:20}}>{formatDate(entry.date)} {formatTime(entry.date)}</p>
    <div style={s.detailSection}><p style={s.sectionLabel}>記録</p><p style={s.detailText}>{entry.text}</p></div>
    {entry.feedback && <div style={{...s.detailSection,borderColor:"#111"}}><p style={s.sectionLabel}>AI フィードバック</p><p style={s.detailText}>{entry.feedback}</p></div>}
  </div>;
}

function MicIcon({size=24}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>; }
function Spinner() { return <div style={{display:"flex",gap:8}}>{[0,1,2].map((i) => <div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#111",animation:`bounce 0.6s ${i*0.2}s infinite alternate`}}/>)}</div>; }

const s = {
  app:{fontFamily:"'Georgia',serif",background:"#fafaf8",minHeight:"100vh",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",color:"#111"},
  header:{padding:"24px 24px 16px",borderBottom:"1px solid #e8e8e4",display:"flex",alignItems:"baseline",gap:10},
  logo:{fontSize:22,fontWeight:700,letterSpacing:"-0.5px"},
  logoSub:{fontSize:11,color:"#999",letterSpacing:"0.05em",textTransform:"uppercase"},
  main:{flex:1,overflowY:"auto",paddingBottom:80},
  view:{padding:"24px 20px"},
  center:{padding:"40px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:16},
  label:{fontSize:13,letterSpacing:"0.1em",textTransform:"uppercase",color:"#888",margin:0},
  micBtn:{width:88,height:88,borderRadius:"50%",border:"1.5px solid #111",background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#111"},
  hint:{fontSize:12,color:"#aaa",margin:0,textAlign:"center"},
  divider:{width:"100%",height:1,background:"#e8e8e4"},
  textarea:{width:"100%",border:"1px solid #ddd",borderRadius:4,padding:"12px 14px",fontSize:15,lineHeight:1.7,resize:"vertical",fontFamily:"inherit",color:"#111",background:"#fff",boxSizing:"border-box",outline:"none"},
  primaryBtn:{background:"#111",color:"#fff",border:"none",borderRadius:4,padding:"12px 24px",fontSize:14,cursor:"pointer",fontFamily:"inherit"},
  ghostBtn:{background:"transparent",color:"#888",border:"1px solid #ddd",borderRadius:4,padding:"12px 20px",fontSize:14,cursor:"pointer",fontFamily:"inherit"},
  stopBtn:{background:"#fff",color:"#111",border:"1.5px solid #111",borderRadius:4,padding:"12px 32px",fontSize:14,cursor:"pointer",fontFamily:"inherit"},
  recDot:{width:12,height:12,borderRadius:"50%",background:"#111"},
  timer:{fontSize:48,fontWeight:300,letterSpacing:"0.05em",margin:0},
  editWrap:{padding:"24px 20px",display:"flex",flexDirection:"column",gap:16},
  row:{display:"flex",gap:10,justifyContent:"flex-end"},
  feedbackBox:{border:"1px solid #111",borderRadius:4,padding:16,background:"#fff"},
  feedbackLabel:{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:"#888",margin:"0 0 10px"},
  feedbackText:{fontSize:14,lineHeight:1.8,color:"#222",margin:0,whiteSpace:"pre-line"},
  entryPreview:{background:"#f5f5f2",borderRadius:4,padding:14},
  entryText:{fontSize:14,lineHeight:1.7,color:"#444",margin:0},
  error:{background:"#fff3f3",border:"1px solid #ffcdd2",borderRadius:4,padding:"10px 16px",margin:"16px 20px 0",fontSize:13,color:"#c62828"},
  emptyWrap:{padding:"80px 20px",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",gap:8},
  entryCard:{width:"100%",background:"#fff",border:"1px solid #e8e8e4",borderRadius:4,padding:"14px 16px",marginBottom:10,cursor:"pointer",textAlign:"left",fontFamily:"inherit"},
  entryCardTop:{display:"flex",justifyContent:"space-between",marginBottom:6},
  entryDate:{fontSize:12,color:"#111",fontWeight:600},
  entryTime:{fontSize:11,color:"#aaa"},
  entrySnippet:{fontSize:13,color:"#666",lineHeight:1.6,margin:0},
  backBtn:{background:"none",border:"none",cursor:"pointer",fontSize:14,color:"#888",padding:0,marginBottom:16,fontFamily:"inherit"},
  detailSection:{border:"1px solid #e8e8e4",borderRadius:4,padding:16,marginBottom:14,background:"#fff"},
  sectionLabel:{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:"#bbb",margin:"0 0 10px"},
  detailText:{fontSize:14,lineHeight:1.8,color:"#333",margin:0,whiteSpace:"pre-line"},
  nav:{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fafaf8",borderTop:"1px solid #e8e8e4",display:"flex",padding:"8px 0 16px"},
  navBtn:{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"8px 0",fontFamily:"inherit",color:"#bbb"},
  navActive:{color:"#111"},
  navIcon:{fontSize:18,lineHeight:1},
  navLabel:{fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase"},
  toast:{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#111",color:"#fff",padding:"10px 24px",borderRadius:4,fontSize:13,zIndex:100},
};
