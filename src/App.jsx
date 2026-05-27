import { useState, useEffect, useRef } from "react";

const DEFAULT_PLAN = {
  Push: [
    {name:"Chest Press",sets:3},{name:"Schrägbankdrücken",sets:3},{name:"Butterflies",sets:3},
    {name:"Schulterdrücken",sets:3},{name:"Seitenheben",sets:3},
    {name:"Overhead Triceps Extensions",sets:3},{name:"Tricep Pushdowns",sets:3}
  ],
  Pull: [
    {name:"Latzug",sets:3},{name:"Klimmzüge",sets:3},{name:"Rudern an Maschine",sets:3},
    {name:"Face Pulls",sets:3},{name:"Preacher Curls",sets:3},
    {name:"Hammer Curls",sets:3},{name:"Rückenstrecken",sets:3}
  ],
  Legs: [
    {name:"Leg Press",sets:3},{name:"Beinstrecker",sets:3},{name:"Beinbeuger",sets:3},
    {name:"Wadenheben",sets:3},{name:"Plank",sets:3},{name:"Bauchcurls",sets:3},
    {name:"Abductor Ziehen",sets:3},{name:"Abductor Stossen",sets:3}
  ],
};

// Migrate old string-based plan to object-based
function migratePlan(p) {
  if (!p) return DEFAULT_PLAN;
  const migrated = {};
  Object.keys(p).forEach(day => {
    migrated[day] = (p[day]||[]).map(ex =>
      typeof ex === "string" ? { name: ex, sets: 3 } : ex
    );
  });
  return migrated;
}
const PLAN_KEY = "gainz_plan";

const DAY_COLORS = {
  Push: { accent: "#f97316", dim: "rgba(249,115,22,0.12)", border: "rgba(249,115,22,0.25)", glow: "rgba(249,115,22,0.08)" },
  Pull: { accent: "#06b6d4", dim: "rgba(6,182,212,0.12)", border: "rgba(6,182,212,0.25)", glow: "rgba(6,182,212,0.08)" },
  Legs: { accent: "#a855f7", dim: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.25)", glow: "rgba(168,85,247,0.08)" },
};

const TIMER_PRESETS = [
  { label: "90 SEK", sublabel: "Isolation", seconds: 90,  color: "#06b6d4" },
  { label: "2 MIN",  sublabel: "Standard",  seconds: 120, color: "#22c55e" },
  { label: "3 MIN",  sublabel: "Compound",  seconds: 180, color: "#f97316" },
  { label: "⚙️",     sublabel: "Eigene",    seconds: 0,   color: "#a855f7" },
];

const STORAGE_KEY = "gainz_v3";
const ACTIVE_KEY  = "gainz_active";

function getAdvice(sets) {
  const filled = sets.filter(s => s !== null && s > 0);
  if (!filled.length) return null;
  const avg = filled.reduce((a, s) => a + s, 0) / filled.length;
  if (avg >= 10) return { emoji: "⬆️", text: "Gewicht erhöhen!", color: "#22c55e" };
  if (avg >= 7)  return { emoji: "✅", text: "Gleiches Gewicht",  color: "#06b6d4" };
  return { emoji: "⬇️", text: "Gewicht reduzieren", color: "#f97316" };
}

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function formatDate(iso) { return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" }); }
function pad(n) { return String(n).padStart(2, "0"); }

// Pleasant bell/chime using Web Audio API
function playDoneSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.start(t);
      osc.stop(t + 0.8);
    });
  } catch (e) {}
}

// Simple audio using HTML Audio - works reliably on iOS PWA
const chimeAudio = typeof Audio !== "undefined" ? new Audio("/chime.wav") : null;

function playDoneSound2() {
  try {
    if (chimeAudio) {
      chimeAudio.currentTime = 0;
      chimeAudio.play().catch(e => console.log("Audio blocked:", e));
    }
  } catch (e) { console.log("Audio error:", e); }
}

export default function App() {
  const [tab, setTab]             = useState("home");
  const [activeDay, setActiveDay] = useState(null);
  const [history, setHistory]     = useState(() => load(STORAGE_KEY, {}));
  const [workout, setWorkout]     = useState(() => {
    const w = load(ACTIVE_KEY, null);
    if (!w || !w.exercises) return w;
    // Migration: split "Latzug / Klimmzüge"
    if (w.exercises["Latzug / Klimmzüge"]) {
      const old = w.exercises["Latzug / Klimmzüge"];
      delete w.exercises["Latzug / Klimmzüge"];
      w.exercises["Latzug"] = { weight: old.weight, sets: [null,null,null], done: false, activeSet: 0 };
      w.exercises["Klimmzüge"] = { weight: "", sets: [null,null,null], done: false, activeSet: 0 };
    }
    // Migration: add any missing exercises from current plan
    // Add missing exercises from plan
    const currentPlan = migratePlan(load(PLAN_KEY, DEFAULT_PLAN));
    Object.values(currentPlan).flat().forEach(exObj => {
      const name = exObj.name||exObj;
      if (!w.exercises[name]) {
        const numSets = Math.min(Math.max(exObj.sets||3, 1), 3);
        w.exercises[name] = { weight: "", sets: Array(numSets).fill(null), done: false, activeSet: 0 };
      }
    });
    return w;
  });
  const [historyDay, setHistoryDay] = useState("Push");
  const [plan, setPlan] = useState(() => migratePlan(load(PLAN_KEY, DEFAULT_PLAN)));
  const [editingPlan, setEditingPlan] = useState(false);
  const [editDay, setEditDay] = useState("Push");
  const [newExName, setNewExName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(null); // day to switch to
  const [confirmReset, setConfirmReset] = useState(false); // {day, index, name}
  const [bwInput, setBwInput] = useState("");
  const [bwSaved, setBwSaved] = useState(false);
  const [bodyWeights, setBodyWeights] = useState(() => load("gainz_bodyweight", []));

  // Timer - real-time based to avoid iOS background drift
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerTarget,  setTimerTarget]  = useState(120);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerDone,    setTimerDone]    = useState(false);
  const [customTimerInput, setCustomTimerInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null); // real start time
  const elapsedAtPauseRef = useRef(0); // seconds elapsed when paused

  useEffect(() => save(STORAGE_KEY, history), [history]);
  useEffect(() => save(ACTIVE_KEY, workout),  [workout]);
  useEffect(() => save(PLAN_KEY, plan), [plan]);

  useEffect(() => {
    if (timerRunning) {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const elapsed = elapsedAtPauseRef.current + Math.floor((Date.now() - startTimeRef.current) / 1000);
        if (elapsed >= timerTarget) {
          clearInterval(intervalRef.current);
          setTimerRunning(false);
          setTimerDone(true);
          setTimerSeconds(timerTarget);
          elapsedAtPauseRef.current = 0;
          playDoneSound2();
        } else {
          setTimerSeconds(elapsed);
        }
      }, 250); // check 4x per second for accuracy
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [timerRunning, timerTarget]);

  const resetTimer = (target) => {
    clearInterval(intervalRef.current);
    setTimerRunning(false);
    setTimerDone(false);
    setTimerSeconds(0);
    elapsedAtPauseRef.current = 0;
    startTimeRef.current = null;
    if (target !== undefined) setTimerTarget(target);
  };

  // Workout helpers
  const startDay = (day) => {
    if (workout && workout.day !== day) {
      setConfirmSwitch(day);
      return;
    }
    if (workout && workout.day === day) {
      // Resume but sync exercises with current plan
      const synced = { ...workout.exercises };
      plan[day].forEach(ex => {
        const name = ex.name || ex;
        if (!synced[name]) synced[name] = { weight: "", sets: Array(ex.sets||3).fill(null), done: false, activeSet: 0 };
      });
      setWorkout(w => ({ ...w, exercises: synced }));
      setActiveDay(day);
      setTab("workout");
      return;
    }
    const ex = {};
    plan[day].forEach(exObj => { const n = exObj.name||exObj; const numSets = Math.min(Math.max(exObj.sets||3, 1), 3); ex[n] = { weight: "", sets: Array(numSets).fill(null), done: false, activeSet: 0 }; });
    setWorkout({ day, startedAt: new Date().toISOString(), exercises: ex });
    setActiveDay(day);
    setTab("workout");
  };
  const resumeWorkout = () => {
    const synced = { ...(workout?.exercises || {}) };
    plan[workout.day].forEach(exObj => {
      const name = exObj.name||exObj;
      const numSets = Math.min(Math.max(exObj.sets||3, 1), 3);
      if (!synced[name]) {
        synced[name] = { weight: "", sets: Array(numSets).fill(null), done: false, activeSet: 0 };
      } else if (synced[name].sets.length !== numSets) {
        // Resize sets array to match plan, preserving existing values
        const old = synced[name].sets;
        synced[name].sets = Array(numSets).fill(null).map((_, i) => old[i] ?? null);
        if (synced[name].activeSet >= numSets) synced[name].activeSet = numSets - 1;
      }
    });
    setWorkout(w => ({ ...w, exercises: synced }));
    setActiveDay(workout.day);
    setTab("workout");
  };
  const updateWeight  = (name, val) => setWorkout(w => ({ ...w, exercises: { ...w.exercises, [name]: { ...w.exercises[name], weight: val } } }));
  const logReps = (name, reps) => setWorkout(w => {
    const ex = { ...w.exercises[name] };
    const sets = [...ex.sets];
    sets[ex.activeSet] = reps;
    let next = ex.activeSet;
    for (let i = 0; i < 3; i++) { if (sets[i] === null) { next = i; break; } }
    return { ...w, exercises: { ...w.exercises, [name]: { ...ex, sets, activeSet: next } } };
  });
  const selectSet  = (name, i) => setWorkout(w => ({ ...w, exercises: { ...w.exercises, [name]: { ...w.exercises[name], activeSet: i } } }));
  const toggleDone = (name)    => setWorkout(w => ({ ...w, exercises: { ...w.exercises, [name]: { ...w.exercises[name], done: !w.exercises[name].done } } }));
  const finishWorkout = () => {
    const newHist = { ...history };
    const entry = { date: new Date().toISOString(), exercises: {} };
    Object.entries(workout.exercises).forEach(([name, data]) => { entry.exercises[name] = { weight: data.weight, sets: data.sets, numSets: data.sets.length }; });
    newHist[workout.day] = [...(newHist[workout.day] || []), entry];
    setHistory(newHist);
    setHistoryDay(workout.day);
    setWorkout(null);
    setActiveDay(null);
    setTab("history");
  };

  const colors = activeDay ? DAY_COLORS[activeDay] : null;

  const G = `
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
    input { -webkit-appearance: none; }
    .sb:active { transform: scale(0.95); }
    .rb:active { transform: scale(0.9);  }
    @keyframes done-flash { 0%,100%{opacity:1} 50%{opacity:0.3} }
    @keyframes done-ring  { 0%{transform:scale(1);opacity:.5} 50%{transform:scale(1.06);opacity:.15} 100%{transform:scale(1);opacity:.5} }
  `;
  const base = { minHeight:"100vh", background:"#080810", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif", color:"#e8e8f0", paddingBottom:"80px" };

  const BottomNav = () => {
    const showBanner = (timerRunning || (timerSeconds > 0 && !timerDone)) && tab !== "timer";
    const remaining = timerTarget - timerSeconds;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return (
      <div style={{ position:"fixed",bottom:0,left:0,right:0,zIndex:100 }}>
        {showBanner && (
          <button onClick={() => setTab("timer")} style={{
            width:"100%", padding:"10px 20px",
            background: timerDone ? "rgba(34,197,94,0.15)" : "rgba(8,8,16,0.97)",
            borderTop:`1px solid ${timerDone?"rgba(34,197,94,0.4)":"rgba(99,102,241,0.3)"}`,
            display:"flex", alignItems:"center", justifyContent:"space-between",
            cursor:"pointer", fontFamily:"inherit"
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
              <span style={{ fontSize:"16px" }}>{timerRunning ? "⏱" : "⏸"}</span>
              <span style={{ fontSize:"13px", color:"#888", letterSpacing:"1px" }}>SATZPAUSE</span>
            </div>
            <div style={{ fontSize:"22px", fontWeight:"800", letterSpacing:"-1px",
              color: remaining <= 10 ? "#f97316" : remaining <= 30 ? "#fbbf24" : "#a5b4fc"
            }}>
              {pad(mins)}:{pad(secs)}
            </div>
          </button>
        )}
        <div style={{ background:"rgba(8,8,16,0.97)",borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",padding:"10px 16px 24px",gap:"8px",backdropFilter:"blur(16px)" }}>
          {[{id:"home",label:"HOME",icon:"⚡"},{id:"timer",label:"TIMER",icon:"⏱"},{id:"history",label:"VERLAUF",icon:"📊"},{id:"settings",label:"PLAN",icon:"⚙️"}].map(t => (
            <button key={t.id} onClick={() => {
              if (t.id === "home" && workout) {
                if (activeDay) setTab("workout");
                else resumeWorkout();
              } else {
                setTab(t.id);
              }
            }} style={{ flex:1,padding:"10px 6px",background:(t.id==="home"&&workout?tab==="workout":tab===t.id)?"rgba(255,255,255,0.07)":"transparent",border:`1px solid ${(t.id==="home"&&workout?tab==="workout":tab===t.id)?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.04)"}`,borderRadius:"12px",color:(t.id==="home"&&workout?tab==="workout":tab===t.id)?"#e8e8f0":"#444",fontSize:"12px",fontWeight:"700",letterSpacing:"1px",fontFamily:"inherit",cursor:"pointer" }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>
    );
  };

  // ── HOME ──
  if (tab === "home") return (
    <div style={base}><style>{G}</style>
      <div style={{ padding:"48px 24px 20px" }}>
        <div style={{ fontSize:"11px",letterSpacing:"4px",color:"#444",marginBottom:"6px" }}>DEIN plan</div>
        <div style={{ fontSize:"42px",fontWeight:"800",letterSpacing:"-1px",lineHeight:1 }}>GAINZ<span style={{ color:"#f97316" }}>.</span></div>
      </div>
      {workout && (
        <div style={{ margin:"0 24px 16px" }}>
          <button onClick={resumeWorkout} style={{ width:"100%",padding:"16px 20px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:"14px",cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div>
              <div style={{ fontSize:"11px",color:"#22c55e",letterSpacing:"2px",marginBottom:"2px" }}>LAUFENDES WORKOUT</div>
              <div style={{ fontSize:"20px",fontWeight:"800",color:"#f0f0f8" }}>{workout.day.toUpperCase()} FORTSETZEN →</div>
            </div>
            <div style={{ fontSize:"24px" }}>▶️</div>
          </button>
        </div>
      )}
      <div style={{ padding:"0 24px" }}>
        {Object.entries(DAY_COLORS).map(([day, c]) => {
          const isActive = workout?.day === day;
          return (
            <button key={day} onClick={() => startDay(day)} style={{ width:"100%",marginBottom:"12px",padding:"22px",background:isActive?"rgba(34,197,94,0.06)":c.glow,border:`1px solid ${isActive?"rgba(34,197,94,0.25)":c.border}`,borderRadius:"16px",cursor:"pointer",textAlign:"left",display:"block" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:"11px",letterSpacing:"3px",color:isActive?"#22c55e":c.accent,marginBottom:"4px" }}>{day==="Push"?"MONTAG":day==="Pull"?"MITTWOCH":"FREITAG"}{isActive?" · AKTIV":""}</div>
                  <div style={{ fontSize:"30px",fontWeight:"800",color:"#f0f0f8" }}>{day.toUpperCase()}</div>
                  <div style={{ fontSize:"12px",color:"#555",marginTop:"2px" }}>{(plan[day]||[]).length} Übungen</div>
                </div>
                <div style={{ fontSize:"26px",opacity:0.6 }}>{day==="Push"?"💪":day==="Pull"?"🔗":"🦵"}</div>
              </div>
            </button>
          );
        })}
      </div>
      {/* Switch workout confirmation */}
      {confirmSwitch && (
        <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end" }}>
          <div style={{ width:"100%",background:"#0d0d18",borderRadius:"20px 20px 0 0",padding:"28px 24px 48px" }}>
            <div style={{ fontSize:"20px",fontWeight:"700",marginBottom:"8px" }}>Workout wechseln?</div>
            <div style={{ fontSize:"15px",color:"#666",marginBottom:"24px" }}>
              Du hast ein aktives <span style={{ color:"#e8e8f0",fontWeight:"600" }}>{workout?.day}</span> Workout. Wenn du zu <span style={{ color:"#e8e8f0",fontWeight:"600" }}>{confirmSwitch}</span> wechselst, geht ungespeicherter Fortschritt verloren.
            </div>
            <div style={{ display:"flex",gap:"12px" }}>
              <button onClick={() => setConfirmSwitch(null)} style={{ flex:1,padding:"16px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#aaa",fontSize:"16px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>ABBRECHEN</button>
              <button onClick={() => {
                const day = confirmSwitch;
                setConfirmSwitch(null);
                const ex = {};
                plan[day].forEach(exObj => {
                  const n = exObj.name||exObj;
                  const numSets = Math.min(Math.max(exObj.sets||3,1),3);
                  ex[n] = { weight:"", sets: Array(numSets).fill(null), done:false, activeSet:0 };
                });
                setWorkout({ day, startedAt: new Date().toISOString(), exercises: ex });
                setActiveDay(day);
                setTab("workout");
              }} style={{ flex:1,padding:"16px",background:"rgba(255,68,68,0.12)",border:"1px solid rgba(255,68,68,0.3)",borderRadius:"12px",color:"#ff4444",fontSize:"16px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer" }}>WECHSELN ✕</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );

  // ── TIMER ──
  if (tab === "timer") {
    const SIZE = 280;
    const CX = SIZE / 2;
    const R = 118;
    const CIRC = 2 * Math.PI * R;
    const progress = timerSeconds / timerTarget;
    const dashOffset = CIRC * (1 - progress);
    const remaining = timerTarget - timerSeconds;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const activePreset = TIMER_PRESETS.find(p => p.seconds === timerTarget);
    const timerColor = timerDone ? "#22c55e" : (activePreset?.color || "#06b6d4");

    return (
      <div style={base}><style>{G}</style>
        <div style={{ padding:"48px 24px 20px" }}>
          <div style={{ fontSize:"11px",letterSpacing:"4px",color:"#444",marginBottom:"6px" }}>SATZPAUSE</div>
          <div style={{ fontSize:"36px",fontWeight:"800",letterSpacing:"-1px" }}>TIMER<span style={{ color:"#f97316" }}>.</span></div>
        </div>

        {/* Presets */}
        <div style={{ display:"flex",gap:"8px",padding:"0 24px",marginBottom:"28px" }}>
          {TIMER_PRESETS.map(p => (
            <button key={p.label} onClick={() => {
              if (p.seconds === 0) { setShowCustomInput(true); return; }
              resetTimer(p.seconds);
            }} style={{ flex:1,padding:"12px 6px",background:(p.seconds===0?showCustomInput:timerTarget===p.seconds)?`${p.color}18`:"rgba(255,255,255,0.03)",border:`1px solid ${(p.seconds===0?showCustomInput:timerTarget===p.seconds)?p.color+"55":"rgba(255,255,255,0.07)"}`,borderRadius:"12px",cursor:"pointer",textAlign:"center",fontFamily:"inherit" }}>
              <div style={{ fontSize:"16px",fontWeight:"800",color:timerTarget===p.seconds?p.color:"#555" }}>{p.label}</div>
              <div style={{ fontSize:"10px",color:timerTarget===p.seconds?p.color+"aa":"#333",letterSpacing:"1px",marginTop:"2px" }}>{p.sublabel}</div>
            </button>
          ))}
        </div>

        {/* Circle timer — fully contained SVG */}
        <div style={{ display:"flex",justifyContent:"center",alignItems:"center",marginBottom:"24px",position:"relative",height:`${SIZE}px` }}>
          {timerRunning && (
            <div style={{ position:"absolute",width:`${SIZE}px`,height:`${SIZE}px`,borderRadius:"50%",border:`2px solid ${timerColor}`,animation:"done-ring 2s ease-in-out infinite",pointerEvents:"none" }} />
          )}
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display:"block" }}>
            <circle cx={CX} cy={CX} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
            <circle
              cx={CX} cy={CX} r={R} fill="none"
              stroke={timerColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${CX} ${CX})`}
              style={{ transition:"stroke-dashoffset 0.95s linear,stroke 0.3s" }}
            />
          </svg>
          {/* Center text overlaid absolutely inside the fixed-height container */}
          <div style={{ position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",width:"200px" }}>
            {timerDone ? (
              <div style={{ animation:"done-flash 1s ease-in-out infinite" }}>
                <div style={{ fontSize:"44px",lineHeight:1 }}>✅</div>
                <div style={{ fontSize:"18px",fontWeight:"800",color:"#22c55e",letterSpacing:"2px",marginTop:"6px" }}>LOS GEHT'S!</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize:"54px",fontWeight:"800",letterSpacing:"-2px",lineHeight:1,color:timerColor }}>{pad(mins)}:{pad(secs)}</div>
                <div style={{ fontSize:"11px",color:"#444",letterSpacing:"2px",marginTop:"6px" }}>{timerRunning?"LÄUFT...":timerSeconds>0?"PAUSIERT":"BEREIT"}</div>
              </>
            )}
          </div>
        </div>

        {/* Custom timer input */}
        {showCustomInput && (
          <div style={{ display:"flex",gap:"8px",padding:"0 24px",marginBottom:"16px" }}>
            <input
              type="number"
              value={customTimerInput}
              onChange={e => setCustomTimerInput(e.target.value)}
              placeholder="Sekunden eingeben..."
              autoFocus
              style={{ flex:1,padding:"12px",background:"rgba(168,85,247,0.08)",border:"1px solid rgba(168,85,247,0.3)",borderRadius:"12px",color:"#e8e8f0",fontSize:"18px",fontWeight:"700",fontFamily:"inherit",outline:"none",textAlign:"center" }}
            />
            <button onClick={() => {
              const secs = parseInt(customTimerInput);
              if (secs > 0 && secs <= 3600) {
                resetTimer(secs);
                setShowCustomInput(false);
                setCustomTimerInput("");
              }
            }} style={{ padding:"12px 18px",background:"rgba(168,85,247,0.15)",border:"1px solid rgba(168,85,247,0.3)",borderRadius:"12px",color:"#a855f7",fontSize:"16px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer" }}>OK</button>
          </div>
        )}

        {/* Info */}
        <div style={{ textAlign:"center",padding:"0 32px",marginBottom:"24px",minHeight:"36px" }}>
          {activePreset && <div style={{ fontSize:"13px",color:"#444",lineHeight:1.6 }}>
            {activePreset.seconds===90 &&"Ideal für Isolation (Curls, Extensions, Flyes) – kurze Pause reicht für kleine Muskeln."}
            {activePreset.seconds===120&&"Standard-Pause für die meisten Übungen – genug Erholung für den nächsten Satz."}
            {activePreset.seconds===180&&"Compound-Übungen (Bankdrücken, Leg Press) – schwere Lasten brauchen mehr Erholung."}
          </div>}
        </div>

        {/* Controls */}
        <div style={{ display:"flex",gap:"12px",padding:"0 24px" }}>
          <button onClick={() => {
            if (timerRunning) {
              // Pausing - save elapsed
              elapsedAtPauseRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000);
              setTimerRunning(false);
            } else {
              setTimerRunning(true);
            }
          }} style={{ flex:2,padding:"18px",background:timerRunning?"rgba(255,68,68,0.12)":`${timerColor}22`,border:`1px solid ${timerRunning?"rgba(255,68,68,0.3)":timerColor+"44"}`,borderRadius:"14px",cursor:"pointer",color:timerRunning?"#ff4444":timerColor,fontSize:"20px",fontWeight:"800",letterSpacing:"2px",fontFamily:"inherit" }}>
            {timerRunning?"⏸ PAUSE":timerSeconds>0&&!timerDone?"▶ WEITER":"▶ START"}
          </button>
          <button onClick={() => resetTimer()} style={{ flex:1,padding:"18px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px",cursor:"pointer",color:"#555",fontSize:"16px",fontWeight:"700",fontFamily:"inherit" }}>↺ RESET</button>
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── WORKOUT ──
  if (tab === "workout" && workout) {
    const exercises = workout.exercises;
    const currentExercises = (plan[activeDay] || []).map(ex => ex.name||ex);
    const allDone   = currentExercises.every(n => exercises[n]?.done);
    const doneCnt   = currentExercises.filter(n => exercises[n]?.done).length;
    const total     = currentExercises.length;

    return (
      <div style={base}><style>{G}</style>
        {/* Header — no timer button */}
        <div style={{ padding:"24px 20px 14px",borderBottom:`1px solid ${colors.border}`,background:colors.glow,position:"sticky",top:0,zIndex:10,backdropFilter:"blur(12px)" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div>
              <div style={{ fontSize:"11px",letterSpacing:"3px",color:colors.accent }}>{activeDay==="Push"?"MONTAG":activeDay==="Pull"?"MITTWOCH":"FREITAG"} · {doneCnt}/{total}</div>
              <div style={{ fontSize:"28px",fontWeight:"800" }}>{activeDay.toUpperCase()} DAY</div>
            </div>
            <div style={{ display:"flex",gap:"8px" }}>
              <button onClick={() => setConfirmCancel(true)} style={{ padding:"8px 12px",background:"rgba(255,68,68,0.08)",border:"1px solid rgba(255,68,68,0.2)",borderRadius:"8px",color:"#ff4444",fontSize:"12px",fontFamily:"inherit",cursor:"pointer",fontWeight:"700",letterSpacing:"0.5px" }}>✕ ABBRECHEN</button>
              <button onClick={() => setTab("home")} style={{ padding:"8px 14px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"8px",color:"#888",fontSize:"13px",fontFamily:"inherit",cursor:"pointer" }}>← HOME</button>
            </div>
          </div>
          <div style={{ marginTop:"10px",height:"3px",background:"rgba(255,255,255,0.06)",borderRadius:"2px" }}>
            <div style={{ height:"100%",borderRadius:"2px",background:colors.accent,width:`${(doneCnt/total)*100}%`,transition:"width 0.4s ease" }} />
          </div>
        </div>

        <div style={{ padding:"16px 20px" }}>
          {currentExercises.map(name => {
            const ex = exercises[name] || { weight: "", sets: [null,null,null], done: false, activeSet: 0 };
            const isPlank = name === "Plank";
            const advice = isPlank ? null : getAdvice(ex.sets);
            const allSetsLogged = ex.sets.every(s => s !== null);
            const dayHist = history[activeDay] || [];
            const lastSession = dayHist.length > 0 ? dayHist[dayHist.length-1].exercises[name] : null;
            const PLANK_TIMES = [20,30,40,45,50,60,75,90,120];

            return (
              <div key={name} style={{ marginBottom:"12px",background:ex.done?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.04)",border:`1px solid ${ex.done?"rgba(34,197,94,0.2)":colors.border}`,borderRadius:"16px",overflow:"hidden",opacity:ex.done?0.6:1,transition:"all 0.3s" }}>
                <div style={{ padding:"14px 16px",borderBottom:ex.done?"none":"1px solid rgba(255,255,255,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div style={{ fontSize:"19px",fontWeight:"700" }}>{name}</div>
                  <button onClick={() => toggleDone(name)} style={{ padding:"6px 14px",background:ex.done?"rgba(34,197,94,0.15)":"rgba(255,255,255,0.06)",border:`1px solid ${ex.done?"rgba(34,197,94,0.4)":"rgba(255,255,255,0.1)"}`,borderRadius:"20px",cursor:"pointer",color:ex.done?"#22c55e":"#888",fontSize:"12px",fontFamily:"inherit",letterSpacing:"1px" }}>{ex.done?"✓ FERTIG":"FERTIG"}</button>
                </div>
                {!ex.done && (
                  <div style={{ padding:"14px 16px" }}>
                    {isPlank ? (
                      <>
                        {lastSession && <div style={{ fontSize:"12px",color:"#444",marginBottom:"12px" }}>LETZTES MAL: {(lastSession.sets||[]).filter(s=>s!==null).map(s=>`${s}s`).join(" / ")}</div>}
                        <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"8px" }}>SATZ {ex.activeSet+1} AKTIV · ANTIPPEN ZUM WECHSELN</div>
                        <div style={{ display:"flex",gap:"8px",marginBottom:"14px" }}>
                          {ex.sets.map((secs,i) => {
                            const isActive=i===ex.activeSet, isFilled=secs!==null;
                            return (
                              <div key={i} className="sb" onClick={()=>selectSet(name,i)} style={{ flex:1,borderRadius:"12px",padding:"10px 6px",background:isActive?colors.dim:isFilled?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.03)",border:`2px solid ${isActive?colors.accent:isFilled?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.06)"}`,textAlign:"center",cursor:"pointer" }}>
                                <div style={{ fontSize:"10px",color:isActive?colors.accent:"#555",letterSpacing:"1px",marginBottom:"4px" }}>SATZ {i+1}</div>
                                <div style={{ fontSize:"22px",fontWeight:"800",color:isFilled?(isActive?colors.accent:"#22c55e"):isActive?colors.accent:"#333" }}>{isFilled?`${secs}s`:"–"}</div>
                                <div style={{ fontSize:"9px",color:isActive?colors.accent:"#444",marginTop:"2px" }}>{isFilled?(isActive?"ÄNDERN":"SEK"):""}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"8px" }}>SEKUNDEN WÄHLEN</div>
                        <div style={{ display:"flex",flexWrap:"wrap",gap:"6px" }}>
                          {PLANK_TIMES.map(n => (
                            <button key={n} className="rb" onClick={()=>logReps(name,n)} style={{ padding:"0 14px",height:"44px",borderRadius:"10px",background:ex.sets[ex.activeSet]===n?colors.dim:"rgba(255,255,255,0.05)",border:`1px solid ${ex.sets[ex.activeSet]===n?colors.border:"rgba(255,255,255,0.1)"}`,color:ex.sets[ex.activeSet]===n?colors.accent:"#ccc",fontSize:"15px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>{n}s</button>
                          ))}
                        </div>
                        {allSetsLogged && (
                          <div style={{ marginTop:"12px",padding:"10px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:"10px" }}>
                            {(() => { const avg=(ex.sets.reduce((a,s)=>a+(s||0),0)/3); return avg>=60?<><span style={{fontSize:"22px"}}>⬆️</span><span style={{fontSize:"15px",fontWeight:"600",color:"#22c55e"}}>Länger halten!</span></>:avg>=40?<><span style={{fontSize:"22px"}}>✅</span><span style={{fontSize:"15px",fontWeight:"600",color:"#06b6d4"}}>Gute Zeit!</span></>:<><span style={{fontSize:"22px"}}>💪</span><span style={{fontSize:"15px",fontWeight:"600",color:"#f97316"}}>Weiter üben!</span></>; })()}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {lastSession && <div style={{ fontSize:"12px",color:"#444",marginBottom:"12px" }}>LETZTES MAL: {lastSession.weight}kg · {(lastSession.sets||[]).filter(s=>s!==null).map(r=>`${r} Reps`).join(" / ")}</div>}
                        <div style={{ display:"flex",alignItems:"center",gap:"10px",marginBottom:"14px" }}>
                          <div style={{ fontSize:"12px",color:"#555",letterSpacing:"2px",width:"60px" }}>GEWICHT</div>
                          <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                            <button onClick={() => updateWeight(name, Math.max(0,(parseFloat(ex.weight)||0)-2.5))} style={{ width:"32px",height:"32px",borderRadius:"8px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:"18px",cursor:"pointer",fontFamily:"inherit" }}>−</button>
                            <input type="number" value={ex.weight} onChange={e=>updateWeight(name,e.target.value)} placeholder="0" style={{ width:"72px",padding:"8px",textAlign:"center",background:"rgba(255,255,255,0.07)",border:`1px solid ${colors.border}`,borderRadius:"10px",color:colors.accent,fontSize:"22px",fontWeight:"700",fontFamily:"inherit",outline:"none" }} />
                            <button onClick={() => updateWeight(name,(parseFloat(ex.weight)||0)+2.5)} style={{ width:"32px",height:"32px",borderRadius:"8px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:"18px",cursor:"pointer",fontFamily:"inherit" }}>+</button>
                            <div style={{ fontSize:"16px",color:"#555",fontWeight:"600" }}>kg</div>
                          </div>
                        </div>
                        <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"8px" }}>SATZ {ex.activeSet+1} AKTIV · ANTIPPEN ZUM WECHSELN</div>
                        <div style={{ display:"flex",gap:"8px",marginBottom:"14px" }}>
                          {ex.sets.map((reps,i) => {
                            const isActive=i===ex.activeSet, isFilled=reps!==null;
                            return (
                              <div key={i} className="sb" onClick={()=>selectSet(name,i)} style={{ flex:1,borderRadius:"12px",padding:"10px 6px",background:isActive?colors.dim:isFilled?"rgba(34,197,94,0.08)":"rgba(255,255,255,0.03)",border:`2px solid ${isActive?colors.accent:isFilled?"rgba(34,197,94,0.3)":"rgba(255,255,255,0.06)"}`,textAlign:"center",cursor:"pointer" }}>
                                <div style={{ fontSize:"10px",color:isActive?colors.accent:"#555",letterSpacing:"1px",marginBottom:"4px" }}>SATZ {i+1}</div>
                                <div style={{ fontSize:"24px",fontWeight:"800",color:isFilled?(isActive?colors.accent:"#22c55e"):isActive?colors.accent:"#333" }}>{isFilled?reps:"–"}</div>
                                <div style={{ fontSize:"9px",color:isActive?colors.accent:"#444",marginTop:"2px" }}>{isFilled?(isActive?"ÄNDERN":"REPS"):""}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div>
                          <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"8px" }}>{ex.sets[ex.activeSet]!==null?`SATZ ${ex.activeSet+1} ÄNDERN`:`SATZ ${ex.activeSet+1} EINGEBEN`}</div>
                          <div style={{ display:"flex",flexWrap:"wrap",gap:"6px" }}>
                            {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(n => (
                              <button key={n} className="rb" onClick={()=>logReps(name,n)} style={{ width:"44px",height:"44px",borderRadius:"10px",background:ex.sets[ex.activeSet]===n?colors.dim:"rgba(255,255,255,0.05)",border:`1px solid ${ex.sets[ex.activeSet]===n?colors.border:"rgba(255,255,255,0.1)"}`,color:ex.sets[ex.activeSet]===n?colors.accent:"#ccc",fontSize:"16px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>{n}</button>
                            ))}
                          </div>
                        </div>
                        {advice && allSetsLogged && (
                          <div style={{ marginTop:"12px",padding:"10px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",display:"flex",alignItems:"center",gap:"10px" }}>
                            <span style={{ fontSize:"22px" }}>{advice.emoji}</span>
                            <span style={{ fontSize:"15px",fontWeight:"600",color:advice.color }}>{advice.text}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={finishWorkout} disabled={!allDone} style={{ width:"100%",marginTop:"8px",padding:"18px",background:allDone?`linear-gradient(135deg,${colors.accent},${colors.accent}bb)`:"rgba(255,255,255,0.04)",border:`1px solid ${allDone?colors.accent:"rgba(255,255,255,0.08)"}`,borderRadius:"14px",color:allDone?"#fff":"#333",fontSize:"18px",fontWeight:"800",letterSpacing:"2px",fontFamily:"inherit",cursor:allDone?"pointer":"default",transition:"all 0.3s" }}>
            {allDone?"🏁 WORKOUT FERTIG!":`NOCH ${currentExercises.filter(n => !exercises[n]?.done).length} ÜBUNGEN OFFEN`}
          </button>
        </div>
        {/* Cancel workout modal */}
        {confirmCancel && (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end" }}>
            <div style={{ width:"100%",background:"#0d0d18",borderRadius:"20px 20px 0 0",padding:"28px 24px 48px" }}>
              <div style={{ fontSize:"20px",fontWeight:"700",marginBottom:"8px" }}>Workout abbrechen?</div>
              <div style={{ fontSize:"15px",color:"#666",marginBottom:"24px" }}>Alle Einträge dieser Session gehen verloren.</div>
              <div style={{ display:"flex",gap:"12px" }}>
                <button onClick={() => setConfirmCancel(false)} style={{ flex:1,padding:"16px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#aaa",fontSize:"16px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>WEITER TRAINIEREN</button>
                <button onClick={() => { setWorkout(null); setActiveDay(null); setConfirmCancel(false); setTab("home"); }} style={{ flex:1,padding:"16px",background:"rgba(255,68,68,0.12)",border:"1px solid rgba(255,68,68,0.3)",borderRadius:"12px",color:"#ff4444",fontSize:"16px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer" }}>ABBRECHEN ✕</button>
              </div>
            </div>
          </div>
        )}

        <BottomNav />
      </div>
    );
  }

  // ── HISTORY ──
  if (tab === "history") {
    const dayHist = history[historyDay] || [];
    const c = DAY_COLORS[historyDay];
    const saveBodyWeights = (arr) => { save("gainz_bodyweight", arr); setBodyWeights(arr); };

    // Total volume per session for this day
    const sessionVolumes = dayHist.map(session => {
      let total = 0;
      plan[historyDay].forEach(exObj => {
        const name = exObj.name||exObj;
        const ex = session.exercises[name];
        if (!ex || name === "Plank") return;
        const w = parseFloat(ex.weight) || 0;
        const reps = (ex.sets||[]).filter(s=>s!==null).reduce((a,s)=>a+s,0);
        total += w * reps;
      });
      return total;
    });
    const maxVol = Math.max(...sessionVolumes, 1);
    const minVol = Math.min(...sessionVolumes.filter(v=>v>0), 0);
    const latestVol = sessionVolumes[sessionVolumes.length-1] || 0;
    const prevVol = sessionVolumes.length>1 ? sessionVolumes[sessionVolumes.length-2] : null;
    const volDiff = prevVol !== null ? latestVol - prevVol : null;
    const volDiffPct = prevVol ? Math.round((volDiff/prevVol)*100) : null;

    const logBodyWeight = () => {
      const val = parseFloat(bwInput);
      if (!val || val < 30 || val > 250) return;
      const updated = [...bodyWeights, { date: new Date().toISOString(), weight: val }];
      saveBodyWeights(updated);
      setBwInput("");
      setBwSaved(true);
      setTimeout(() => setBwSaved(false), 2000);
    };

    const bwVals = bodyWeights.map(e => e.weight);
    const bwMax = Math.max(...bwVals, 1);
    const bwMin = Math.min(...bwVals, bwMax);
    const bwLatest = bwVals[bwVals.length-1];
    const bwPrev = bwVals.length > 1 ? bwVals[bwVals.length-2] : null;
    const bwDiff = bwPrev !== null ? Math.round((bwLatest - bwPrev)*10)/10 : null;
    // Trend: avg of last 3 vs avg of 3 before that
    const bwTrend = (() => {
      if (bwVals.length < 4) return null;
      const recent = bwVals.slice(-3).reduce((a,b)=>a+b,0)/3;
      const older = bwVals.slice(-6,-3).reduce((a,b)=>a+b,0)/Math.min(3,bwVals.slice(-6,-3).length);
      const diff = Math.round((recent-older)*10)/10;
      if (diff > 0.2) return { text: "Leicht zunehmend", color:"#f97316", emoji:"↗" };
      if (diff < -0.2) return { text: "Leicht abnehmend", color:"#22c55e", emoji:"↘" };
      return { text: "Stabil", color:"#06b6d4", emoji:"→" };
    })();

    const exportData = () => {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        history,
        bodyWeights,
        plan,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gainz-backup-${new Date().toISOString().slice(0,10)}.gainz`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const importData = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.version !== 1) { alert("Ungültige Datei!"); return; }
          if (window.confirm("Alle aktuellen Daten werden überschrieben. Fortfahren?")) {
            if (data.history) { setHistory(data.history); save(STORAGE_KEY, data.history); }
            if (data.bodyWeights) { setBodyWeights(data.bodyWeights); save("gainz_bodyweight", data.bodyWeights); }
            if (data.plan) { setPlan(data.plan); save(PLAN_KEY, data.plan); }
            alert("✅ Daten erfolgreich importiert!");
          }
        } catch { alert("Fehler beim Importieren – ungültige .gainz Datei."); }
      };
      reader.readAsText(file);
      e.target.value = "";
    };

    return (
      <div style={base}><style>{G}</style>
        <div style={{ padding:"40px 24px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-end" }}>
          <div>
            <div style={{ fontSize:"11px",letterSpacing:"4px",color:"#444",marginBottom:"6px" }}>TRAININGS</div>
            <div style={{ fontSize:"36px",fontWeight:"800",letterSpacing:"-1px" }}>VERLAUF<span style={{ color:"#f97316" }}>.</span></div>
          </div>
          {/* Export / Import */}
          <div style={{ display:"flex",gap:"6px",marginBottom:"6px" }}>
            <button onClick={exportData} title="Daten exportieren" style={{
              padding:"8px 12px",background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",
              color:"#666",fontSize:"13px",cursor:"pointer",fontFamily:"inherit",
              display:"flex",alignItems:"center",gap:"5px"
            }}>
              <span>⬆️</span><span style={{ fontSize:"11px",letterSpacing:"1px",fontWeight:"700" }}>EXPORT</span>
            </button>
            <label title="Daten importieren" style={{
              padding:"8px 12px",background:"rgba(255,255,255,0.04)",
              border:"1px solid rgba(255,255,255,0.1)",borderRadius:"10px",
              color:"#666",fontSize:"13px",cursor:"pointer",fontFamily:"inherit",
              display:"flex",alignItems:"center",gap:"5px"
            }}>
              <span>⬇️</span><span style={{ fontSize:"11px",letterSpacing:"1px",fontWeight:"700" }}>IMPORT</span>
              <input type="file" accept=".gainz" onChange={importData} style={{ display:"none" }} />
            </label>
          </div>
        </div>

        {/* ── KÖRPERGEWICHT CARD ── */}
        <div style={{ padding:"0 24px",marginBottom:"20px" }}>
          <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"16px" }}>
            <div style={{ fontSize:"11px",letterSpacing:"3px",color:"#a855f7",marginBottom:"12px" }}>⚖️ KÖRPERGEWICHT</div>

            {/* Input row */}
            <div style={{ display:"flex",gap:"8px",marginBottom:"14px" }}>
              <input
                type="number" value={bwInput}
                onChange={e=>setBwInput(e.target.value)}
                placeholder="z.B. 86.2"
                style={{ flex:1,padding:"12px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(168,85,247,0.3)",borderRadius:"10px",color:"#e8e8f0",fontSize:"18px",fontWeight:"700",fontFamily:"inherit",outline:"none",textAlign:"center" }}
              />
              <button onClick={logBodyWeight} style={{ padding:"12px 20px",background:bwSaved?"rgba(34,197,94,0.15)":"rgba(168,85,247,0.15)",border:`1px solid ${bwSaved?"rgba(34,197,94,0.4)":"rgba(168,85,247,0.3)"}`,borderRadius:"10px",color:bwSaved?"#22c55e":"#a855f7",fontSize:"14px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer",letterSpacing:"1px" }}>
                {bwSaved?"✓ OK":"EINTRAGEN"}
              </button>
            </div>

            {/* Latest + trend */}
            {bwLatest && (
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px" }}>
                <div>
                  <div style={{ fontSize:"32px",fontWeight:"800",color:"#a855f7",letterSpacing:"-1px",lineHeight:1 }}>{bwLatest}<span style={{ fontSize:"14px",color:"#555",fontWeight:"400" }}>kg</span></div>
                  <div style={{ fontSize:"11px",color:"#555",marginTop:"2px" }}>Letzter Eintrag</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  {bwDiff!==null && <div style={{ fontSize:"16px",fontWeight:"700",color:bwDiff>0?"#f97316":bwDiff<0?"#22c55e":"#666" }}>{bwDiff>0?`+${bwDiff}`:bwDiff}kg</div>}
                  {bwTrend && <div style={{ fontSize:"13px",color:bwTrend.color,marginTop:"2px" }}>{bwTrend.emoji} {bwTrend.text}</div>}
                </div>
              </div>
            )}

            {/* Mini chart */}
            {bwVals.length > 1 && (
              <div style={{ marginBottom:"12px" }}>
                <div style={{ display:"flex",alignItems:"flex-end",gap:"3px",height:"48px" }}>
                  {bwVals.slice(-12).map((w,i,arr)=>{
                    const range = bwMax-bwMin||1;
                    const h = Math.max(((w-bwMin)/range)*36+12, 4);
                    const isLatest = i===arr.length-1;
                    return (
                      <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px" }}>
                        <div style={{ width:"100%",height:`${h}px`,background:isLatest?"#a855f7":"rgba(168,85,247,0.25)",borderRadius:"2px 2px 0 0" }} />
                        {isLatest && <div style={{ fontSize:"8px",color:"#a855f7" }}>{w}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Reminder */}
            <div style={{ padding:"8px 10px",background:"rgba(255,255,255,0.02)",borderRadius:"8px",borderLeft:"2px solid rgba(168,85,247,0.3)" }}>
              <div style={{ fontSize:"11px",color:"#444",lineHeight:1.5 }}>
                ⏰ Jeden Tag zur gleichen Zeit messen – am besten morgens nach dem Aufstehen und nach dem Stuhlgang, vor dem Frühstück. Nur so sind die Zahlen wirklich vergleichbar.
              </div>
            </div>
          </div>
        </div>

        {/* Day selector */}
        <div style={{ display:"flex",gap:"8px",padding:"0 24px",marginBottom:"20px" }}>
          {Object.entries(DAY_COLORS).map(([day,dc]) => (
            <button key={day} onClick={()=>setHistoryDay(day)} style={{ flex:1,padding:"10px 6px",background:historyDay===day?dc.dim:"rgba(255,255,255,0.03)",border:`1px solid ${historyDay===day?dc.border:"rgba(255,255,255,0.07)"}`,borderRadius:"10px",color:historyDay===day?dc.accent:"#555",fontSize:"13px",fontWeight:"700",letterSpacing:"1px",fontFamily:"inherit",cursor:"pointer" }}>{day.toUpperCase()}</button>
          ))}
        </div>

        <div style={{ padding:"0 24px" }}>
          {dayHist.length===0 ? (
            <div style={{ textAlign:"center",padding:"60px 0",color:"#333" }}>
              <div style={{ fontSize:"36px",marginBottom:"12px" }}>📋</div>
              <div style={{ fontSize:"16px" }}>Noch kein {historyDay} Workout gespeichert.</div>
            </div>
          ) : (
            <>
              {/* ── VOLUME CARD ── */}
              {dayHist.length >= 1 && latestVol > 0 && (
                <div style={{ background:c.glow,border:`1px solid ${c.border}`,borderRadius:"16px",padding:"16px",marginBottom:"20px" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"4px" }}>
                    <div>
                      <div style={{ fontSize:"11px",letterSpacing:"3px",color:c.accent,marginBottom:"2px" }}>TRAININGSVOLUMEN</div>
                      <div style={{ fontSize:"13px",color:"#555",lineHeight:1.4 }}>Wie hart du insgesamt trainiert hast – (Gewicht × Wiederholungen × Sätze)</div>
                    </div>
                  </div>

                  <div style={{ display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginTop:"12px" }}>
                    <div>
                      <div style={{ fontSize:"38px",fontWeight:"800",color:c.accent,letterSpacing:"-1px",lineHeight:1 }}>
                        {latestVol >= 1000 ? `${(latestVol/1000).toFixed(1)}t` : `${latestVol}kg`}
                      </div>
                      <div style={{ fontSize:"12px",color:"#555",marginTop:"2px" }}>letztes Workout</div>
                    </div>
                    {volDiff !== null && volDiff !== 0 && (
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:"22px",fontWeight:"800",color:volDiff>0?"#22c55e":"#f97316" }}>
                          {volDiff>0?"↑":"↓"} {volDiffPct > 0 ? `+${volDiffPct}` : volDiffPct}%
                        </div>
                        <div style={{ fontSize:"11px",color:"#555" }}>vs. vorheriges</div>
                        <div style={{ fontSize:"11px",color:volDiff>0?"#22c55e":"#f97316",marginTop:"2px" }}>
                          {volDiff>0?"Du wirst stärker! 💪":"Etwas weniger als letztes Mal"}
                        </div>
                      </div>
                    )}
                    {volDiff === 0 && <div style={{ fontSize:"13px",color:"#666" }}>Gleiches Volumen ✅</div>}
                  </div>

                  {/* Volume bar chart across sessions */}
                  {dayHist.length > 1 && (
                    <div style={{ marginTop:"16px" }}>
                      <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"8px" }}>VERLAUF</div>
                      <div style={{ display:"flex",alignItems:"flex-end",gap:"4px",height:"56px" }}>
                        {sessionVolumes.map((vol,i) => {
                          const h = maxVol > 0 ? Math.max(((vol-minVol)/(maxVol-minVol||1))*44+12, 4) : 4;
                          const isLatest = i===sessionVolumes.length-1;
                          return (
                            <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px" }}>
                              <div style={{ width:"100%",height:`${h}px`,background:isLatest?c.accent:"rgba(255,255,255,0.1)",borderRadius:"3px 3px 0 0",transition:"height 0.3s" }} />
                              <div style={{ fontSize:"8px",color:isLatest?c.accent:"#333" }}>
                                {vol>=1000?`${(vol/1000).toFixed(1)}t`:`${Math.round(vol/100)/10}k`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PER EXERCISE ── */}
              {plan[historyDay].map(name => {
                const sessions = dayHist.map(s=>s.exercises[name]).filter(Boolean);
                if (!sessions.length) return null;
                const isPlank = name === "Plank";
                const weights = isPlank ? [] : sessions.map(s=>parseFloat(s.weight)||0);
                const latest=sessions[sessions.length-1];
                const prev=sessions.length>1?sessions[sessions.length-2]:null;
                const latestW=parseFloat(latest.weight)||0;
                const prevW=prev?parseFloat(prev.weight)||0:null;
                const diff=prevW!==null?latestW-prevW:null;

                // Volume per session for this exercise
                const exVolumes = sessions.map(s => {
                  if (isPlank) return null;
                  const w = parseFloat(s.weight)||0;
                  const reps = (s.sets||[]).filter(r=>r!==null).reduce((a,r)=>a+r,0);
                  return w * reps;
                });
                const latestExVol = exVolumes[exVolumes.length-1];
                const prevExVol = exVolumes.length>1 ? exVolumes[exVolumes.length-2] : null;
                const exVolDiff = latestExVol!==null && prevExVol!==null ? latestExVol-prevExVol : null;

                return (
                  <div key={name} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"16px",padding:"16px",marginBottom:"12px" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px" }}>
                      <div>
                        <div style={{ fontSize:"17px",fontWeight:"700" }}>{name}</div>
                        <div style={{ fontSize:"11px",color:"#555",marginTop:"2px" }}>{sessions.length} Session{sessions.length>1?"s":""}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        {!isPlank && <div style={{ fontSize:"22px",fontWeight:"800",color:c.accent }}>{latestW}<span style={{ fontSize:"12px",color:"#555" }}>kg</span></div>}
                        {!isPlank && diff!==null && diff!==0 && <div style={{ fontSize:"12px",color:diff>0?"#22c55e":"#f97316" }}>{diff>0?`+${diff}`:diff}kg</div>}
                      </div>
                    </div>

                    {/* Volume indicator for this exercise */}
                    {!isPlank && latestExVol !== null && latestExVol > 0 && (
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",borderRadius:"8px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.05)",marginBottom:"10px" }}>
                        <div style={{ fontSize:"11px",color:"#555" }}>Arbeitsvolumen</div>
                        <div style={{ display:"flex",alignItems:"center",gap:"8px" }}>
                          <div style={{ fontSize:"14px",fontWeight:"700",color:"#aaa" }}>{latestExVol}kg</div>
                          {exVolDiff!==null && exVolDiff!==0 && (
                            <div style={{ fontSize:"11px",color:exVolDiff>0?"#22c55e":"#f97316",fontWeight:"700" }}>
                              {exVolDiff>0?`+${exVolDiff}`:exVolDiff}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Weight chart */}
                    {!isPlank && sessions.length>1 && (()=>{
                      const maxW2=Math.max(...weights), minW2=Math.min(...weights), range2=maxW2-minW2||1;
                      return (
                        <div style={{ marginBottom:"10px" }}>
                          <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"6px" }}>GEWICHTSVERLAUF</div>
                          <div style={{ display:"flex",alignItems:"flex-end",gap:"4px",height:"40px" }}>
                            {weights.map((w,i)=>(
                              <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px" }}>
                                <div style={{ width:"100%",height:`${((w-minW2)/range2)*28+12}px`,background:i===weights.length-1?c.accent:"rgba(255,255,255,0.1)",borderRadius:"3px 3px 0 0" }} />
                                <div style={{ fontSize:"8px",color:"#444" }}>{w}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    <div style={{ fontSize:"10px",color:"#444",letterSpacing:"2px",marginBottom:"6px" }}>LETZTE SESSIONS</div>
                    {dayHist.slice(-3).reverse().map((session,i)=>{
                      const ex=session.exercises[name]; if(!ex) return null;
                      const adv = isPlank ? null : getAdvice(ex.sets||[]);
                      return (
                        <div key={i} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderTop:i>0?"1px solid rgba(255,255,255,0.04)":"none" }}>
                          <div style={{ fontSize:"12px",color:"#555" }}>{formatDate(session.date)}</div>
                          <div style={{ fontSize:"13px",color:"#aaa" }}>
                            {isPlank
                              ? (ex.sets||[]).filter(s=>s!==null).map(s=>`${s}s`).join(" / ")
                              : `${ex.weight}kg · ${(ex.sets||[]).filter(s=>s!==null).join(" / ")} Reps`}
                          </div>
                          {adv&&<span style={{ fontSize:"14px" }}>{adv.emoji}</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── SETTINGS ──
  if (tab === "settings") {
    return (
      <div style={base}><style>{G}</style>
        <div style={{ padding:"48px 24px 20px" }}>
          <div style={{ fontSize:"11px",letterSpacing:"4px",color:"#444",marginBottom:"6px" }}>EINSTELLUNGEN</div>
          <div style={{ fontSize:"36px",fontWeight:"800",letterSpacing:"-1px" }}>PLAN<span style={{ color:"#f97316" }}>.</span></div>
        </div>

        {/* Day tabs */}
        <div style={{ display:"flex",gap:"8px",padding:"0 24px",marginBottom:"20px" }}>
          {Object.entries(DAY_COLORS).map(([day,dc]) => (
            <button key={day} onClick={() => { setEditDay(day); setNewExName(""); setSwipedEx(null); }} style={{ flex:1,padding:"10px 6px",background:editDay===day?dc.dim:"rgba(255,255,255,0.03)",border:`1px solid ${editDay===day?dc.border:"rgba(255,255,255,0.07)"}`,borderRadius:"10px",color:editDay===day?dc.accent:"#555",fontSize:"13px",fontWeight:"700",letterSpacing:"1px",fontFamily:"inherit",cursor:"pointer" }}>{day.toUpperCase()}</button>
          ))}
        </div>

        <div style={{ padding:"0 24px" }}>
          <div style={{ fontSize:"11px",color:"#444",letterSpacing:"2px",marginBottom:"10px" }}>▲▼ REIHENFOLGE · −/+ SETS · 🗑 LÖSCHEN</div>

          {(plan[editDay]||[]).map((exObj, i) => {
            const exName = exObj.name||exObj;
            const exSets = exObj.sets||3;
            const dc = DAY_COLORS[editDay];
            return (
              <div key={i} style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",marginBottom:"8px",overflow:"hidden" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px" }}>
                  {/* Up/down arrows for reordering */}
                  <div style={{ display:"flex",flexDirection:"column",gap:"2px",marginRight:"10px" }}>
                    <button onClick={() => {
                      if (i === 0) return;
                      const arr = [...plan[editDay]];
                      [arr[i-1], arr[i]] = [arr[i], arr[i-1]];
                      setPlan({ ...plan, [editDay]: arr });
                    }} style={{ width:"24px",height:"22px",borderRadius:"5px",background:i===0?"transparent":"rgba(255,255,255,0.06)",border:i===0?"none":"1px solid rgba(255,255,255,0.1)",color:i===0?"#333":"#aaa",fontSize:"11px",cursor:i===0?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>▲</button>
                    <button onClick={() => {
                      if (i === plan[editDay].length-1) return;
                      const arr = [...plan[editDay]];
                      [arr[i+1], arr[i]] = [arr[i], arr[i+1]];
                      setPlan({ ...plan, [editDay]: arr });
                    }} style={{ width:"24px",height:"22px",borderRadius:"5px",background:i===plan[editDay].length-1?"transparent":"rgba(255,255,255,0.06)",border:i===plan[editDay].length-1?"none":"1px solid rgba(255,255,255,0.1)",color:i===plan[editDay].length-1?"#333":"#aaa",fontSize:"11px",cursor:i===plan[editDay].length-1?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>▼</button>
                  </div>
                  {/* Name */}
                  <div style={{ flex:1,fontSize:"15px",fontWeight:"600" }}>{exName}</div>
                  {/* Sets selector */}
                  <div style={{ display:"flex",alignItems:"center",gap:"6px",marginRight:"10px" }}>
                    <button onClick={() => {
                      if (exSets <= 1) return;
                      const arr = [...plan[editDay]];
                      arr[i] = { name: exName, sets: exSets - 1 };
                      setPlan({ ...plan, [editDay]: arr });
                    }} style={{ width:"26px",height:"26px",borderRadius:"6px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:"14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>−</button>
                    <div style={{ textAlign:"center",minWidth:"32px" }}>
                      <div style={{ fontSize:"16px",fontWeight:"800",color:dc.accent }}>{exSets}</div>
                      <div style={{ fontSize:"9px",color:"#444",letterSpacing:"1px" }}>SETS</div>
                    </div>
                    <button onClick={() => {
                      if (exSets >= 3) return;
                      const arr = [...plan[editDay]];
                      arr[i] = { name: exName, sets: exSets + 1 };
                      setPlan({ ...plan, [editDay]: arr });
                    }} style={{ width:"26px",height:"26px",borderRadius:"6px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#aaa",fontSize:"14px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
                  </div>
                  {/* Delete */}
                  <button onClick={() => setConfirmDelete({ day: editDay, index: i, name: exName })} style={{ width:"32px",height:"32px",borderRadius:"8px",background:"rgba(255,68,68,0.1)",border:"1px solid rgba(255,68,68,0.2)",color:"#ff4444",fontSize:"16px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>🗑</button>
                </div>
              </div>
            );
          })}

          {/* Add new exercise */}
          <div style={{ marginTop:"20px",fontSize:"11px",color:"#444",letterSpacing:"2px",marginBottom:"10px" }}>NEUE ÜBUNG</div>
          <div style={{ display:"flex",gap:"8px" }}>
            <input
              value={newExName}
              onChange={e => setNewExName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newExName.trim()) {
                  setPlan({ ...plan, [editDay]: [...(plan[editDay]||[]), { name: newExName.trim(), sets: 3 }] });
                  setNewExName("");
                }
              }}
              placeholder="z.B. Kabelcurls..."
              style={{ flex:1,padding:"14px",background:"rgba(255,255,255,0.06)",border:`1px solid ${DAY_COLORS[editDay].border}`,borderRadius:"12px",color:"#e8e8f0",fontSize:"15px",fontFamily:"inherit",outline:"none" }}
            />
            <button onClick={() => {
              if (!newExName.trim()) return;
              setPlan({ ...plan, [editDay]: [...(plan[editDay]||[]), { name: newExName.trim(), sets: 3 }] });
              setNewExName("");
            }} style={{ width:"52px",height:"52px",background:DAY_COLORS[editDay].dim,border:`1px solid ${DAY_COLORS[editDay].border}`,borderRadius:"12px",color:DAY_COLORS[editDay].accent,fontSize:"24px",cursor:"pointer",fontFamily:"inherit",fontWeight:"800",display:"flex",alignItems:"center",justifyContent:"center" }}>+</button>
          </div>

          {/* Reset */}
          <button onClick={() => setConfirmReset(true)} style={{ width:"100%",marginTop:"24px",padding:"12px",background:"transparent",border:"1px dashed rgba(255,255,255,0.08)",borderRadius:"10px",color:"#333",fontSize:"12px",fontFamily:"inherit",cursor:"pointer",letterSpacing:"1px" }}>
            ↺ {editDay.toUpperCase()} AUF STANDARD ZURÜCKSETZEN
          </button>
        </div>

        {/* Confirm delete modal */}
        {confirmDelete && (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:300,display:"flex",alignItems:"flex-end" }}>
            <div style={{ width:"100%",background:"#0d0d18",borderRadius:"20px 20px 0 0",padding:"28px 24px 48px" }}>
              <div style={{ fontSize:"20px",fontWeight:"700",marginBottom:"8px" }}>Übung löschen?</div>
              <div style={{ fontSize:"15px",color:"#888",marginBottom:"24px" }}>
                <span style={{ color:"#e8e8f0",fontWeight:"600" }}>{confirmDelete.name}</span> aus {confirmDelete.day} entfernen?
              </div>
              <div style={{ display:"flex",gap:"12px" }}>
                <button onClick={() => { setConfirmDelete(null); setSwipedEx(null); }} style={{ flex:1,padding:"16px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#aaa",fontSize:"16px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>ABBRECHEN</button>
                <button onClick={() => {
                  const updated = { ...plan, [confirmDelete.day]: plan[confirmDelete.day].filter((_,idx) => idx !== confirmDelete.index) };
                  setPlan(updated);
                  setConfirmDelete(null);
                  setSwipedEx(null);
                }} style={{ flex:1,padding:"16px",background:"rgba(255,68,68,0.15)",border:"1px solid rgba(255,68,68,0.3)",borderRadius:"12px",color:"#ff4444",fontSize:"16px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer" }}>LÖSCHEN ✕</button>
              </div>
            </div>
          </div>
        )}

        {/* Reset plan modal */}
        {confirmReset && (
          <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end" }}>
            <div style={{ width:"100%",background:"#0d0d18",borderRadius:"20px 20px 0 0",padding:"28px 24px 48px" }}>
              <div style={{ fontSize:"20px",fontWeight:"700",marginBottom:"8px" }}>{editDay} zurücksetzen?</div>
              <div style={{ fontSize:"15px",color:"#666",marginBottom:"24px" }}>Der {editDay} Plan wird auf die Standard-Übungen zurückgesetzt.</div>
              <div style={{ display:"flex",gap:"12px" }}>
                <button onClick={() => setConfirmReset(false)} style={{ flex:1,padding:"16px",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"12px",color:"#aaa",fontSize:"16px",fontWeight:"700",fontFamily:"inherit",cursor:"pointer" }}>ABBRECHEN</button>
                <button onClick={() => {
                  setPlan({ ...plan, [editDay]: [...DEFAULT_PLAN[editDay]] });
                  setConfirmReset(false);
                }} style={{ flex:1,padding:"16px",background:"rgba(255,149,0,0.12)",border:"1px solid rgba(255,149,0,0.3)",borderRadius:"12px",color:"#ff9500",fontSize:"16px",fontWeight:"800",fontFamily:"inherit",cursor:"pointer" }}>ZURÜCKSETZEN ↺</button>
              </div>
            </div>
          </div>
        )}

        <BottomNav />
      </div>
    );
  }

  return null;
}
