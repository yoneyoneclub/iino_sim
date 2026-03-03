import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── Road topology ────────────────────────────────────────────────────────────
const STOPS = {
  A: { id:"A", name:"Info",   type:"station" },
  B: { id:"B", name:"改札",   type:"gate"    },
  C: { id:"C", name:"ホテル", type:"stop"    },
  D: { id:"D", name:"商業",   type:"stop"    },
};

const DIRECTED_EDGES = [
  { from:"A", to:"B" },
  { from:"B", to:"A" },
  { from:"B", to:"C" },
  { from:"C", to:"B" },
  { from:"B", to:"D" },
  { from:"D", to:"B" },
  { from:"C", to:"D" },
  { from:"D", to:"C" },
];

const ADJ = {};
DIRECTED_EDGES.forEach(({ from: f, to: t }) => {
  ADJ[f] = [...(ADJ[f] || []), t];
});

function shortestPath(from, to) {
  if (from === to) return [from];
  const queue = [[from]], visited = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const cur = path[path.length - 1];
    for (const nb of (ADJ[cur] || [])) {
      if (visited.has(nb)) continue;
      const next = [...path, nb];
      if (nb === to) return next;
      visited.add(nb);
      queue.push(next);
    }
  }
  return null;
}

function expandRoute(waypoints) {
  if (waypoints.length < 2) return waypoints;
  const full = [waypoints[0]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = shortestPath(waypoints[i], waypoints[i + 1]);
    if (seg) seg.slice(1).forEach(s => full.push(s));
  }
  return full;
}

// ─── Lane geometry ────────────────────────────────────────────────────────────
const LANE = 14;

// Initial stop positions (mutable via drag)
const INIT_STOP_POS = {
  A: { x:80,  y:160 },
  B: { x:340, y:160 },
  C: { x:600, y:160 },
  D: { x:470, y:310 },
};

function laneVec(fromId, toId, sp) {
  const dx = sp[toId].x - sp[fromId].x, dy = sp[toId].y - sp[fromId].y;
  const len = Math.hypot(dx, dy) || 1;
  return { ox: (dy / len) * LANE, oy: -(dx / len) * LANE };
}

function lanePos(fromId, toId, t, sp) {
  const { ox, oy } = laneVec(fromId, toId, sp);
  return {
    x: sp[fromId].x + (sp[toId].x - sp[fromId].x) * t + ox,
    y: sp[fromId].y + (sp[toId].y - sp[fromId].y) * t + oy,
  };
}

function segDist(aId, bId, sp) {
  return Math.hypot(sp[bId].x - sp[aId].x, sp[bId].y - sp[aId].y);
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────
const VEHICLE_DEFS = [
  { id:1,  name:"iino-01", mode:"loop", waypoints:["A","B","A"], color:"#22c55e", speed:0.8, active:true },
  { id:2,  name:"iino-02", mode:"loop", waypoints:["A","B","A"], color:"#4ade80", speed:0.6, active:true },
  { id:3,  name:"iino-03", mode:"loop", waypoints:["A","B","A"], color:"#10b981", speed:0.7, active:true },
  { id:4,  name:"iino-04", mode:"loop", waypoints:["A","B","A"], color:"#34d399", speed:0.9, active:true },
  { id:5,  name:"iino-05", mode:"loop", waypoints:["A","B","A"], color:"#6ee7b7", speed:0.8, active:true },
  { id:6,  name:"iino-06", mode:"loop", waypoints:["A","D","A"], color:"#f59e0b", speed:0.8, active:true },
  { id:7,  name:"iino-07", mode:"loop", waypoints:["A","C","A"], color:"#8b5cf6", speed:0.8, active:true },
  { id:8,  name:"iino-08", mode:"loop", waypoints:["A","B","A"], color:"#06b6d4", speed:0.7, active:true },
  { id:9,  name:"iino-09", mode:"loop", waypoints:["A","B","A"], color:"#f472b6", speed:0.6, active:true },
  { id:10, name:"iino-10", mode:"loop", waypoints:["A","B","A"], color:"#fb923c", speed:0.9, active:true },
];

function buildVehicles(defs) {
  return defs.map(d => ({ ...d, route: expandRoute(d.waypoints) }));
}

const MC = { loop:"#22c55e", detour:"#f59e0b", ondemand:"#8b5cf6" };
const ML = { loop:"ループ",  detour:"寄り道",  ondemand:"オンデマンド" };
const SC = { station:"#3b82f6", gate:"#ef4444", terminal:"#f97316", stop:"#64748b" };

// ─── Road rendering helpers ────────────────────────────────────────────────────
function DirectedLane({ fromId, toId, color = "#1e3a2f", sp }) {
  const fx = sp[fromId].x, fy = sp[fromId].y, tx = sp[toId].x, ty = sp[toId].y;
  const { ox, oy } = laneVec(fromId, toId, sp);
  const x1 = fx + ox, y1 = fy + oy, x2 = tx + ox, y2 = ty + oy;
  const dx = tx - fx, dy = ty - fy, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const AW = 7, AL = 10;
  const ax = mx + ux * AL, ay = my + uy * AL;
  const bx = mx - ux * AL / 2 + uy * AW, by = my - uy * AL / 2 - ux * AW;
  const cx2 = mx - ux * AL / 2 - uy * AW, cy2 = my - uy * AL / 2 + ux * AW;

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={LANE * 1.8} strokeLinecap="round" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a0f1e" strokeWidth={1} strokeOpacity={0.4} />
      <polygon points={`${ax},${ay} ${bx},${by} ${cx2},${cy2}`} fill="#fff" opacity={0.18} />
    </g>
  );
}

function RoadBed({ fromId, toId, sp }) {
  return (
    <line x1={sp[fromId].x} y1={sp[fromId].y} x2={sp[toId].x} y2={sp[toId].y}
      stroke="#161f30" strokeWidth={LANE * 4.5} strokeLinecap="round" />
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  // Single source of truth for vehicle definitions
  const [defs,      setDefs]      = useState(VEHICLE_DEFS);
  // vehicles is always derived from defs — no separate state that can desync
  const vehicles = useMemo(() => buildVehicles(defs), [defs]);

  // Stop positions — draggable via SVG
  const [stopPos,   setStopPos]   = useState(INIT_STOP_POS);
  const dragRef = useRef(null); // { id, ox, oy } while dragging

  const [vs,        setVs]        = useState(() =>
    buildVehicles(VEHICLE_DEFS).map((v, i) => ({
      id: v.id, ri: 0, prog: 0,
      pos: { x: INIT_STOP_POS[v.route[0]].x, y: INIT_STOP_POS[v.route[0]].y },
      park: null,
      wait: i * 1.1,
    }))
  );
  const [sel,       setSel]       = useState(null);
  const [tab,       setTab]       = useState("map");
  const [spd,       setSpd]       = useState(0.5);
  const [logs,      setLogs]      = useState([]);
  const [editId,    setEditId]    = useState(1);
  const [localDefs, setLocalDefs] = useState(VEHICLE_DEFS);

  const lt  = useRef(null);
  const vr  = useRef(vehicles);
  vr.current = vehicles;
  // ref so animation loop always reads latest positions without re-subscribing
  const posR = useRef(stopPos);
  posR.current = stopPos;

  const addLog = useCallback(m => setLogs(p => [{ t: Date.now(), m }, ...p].slice(0, 50)), []);

  useEffect(() => {
    let raf;
    const tick = ts => {
      if (!lt.current) lt.current = ts;
      const dt = Math.min((ts - lt.current) / 1000, 0.05) * spd;
      lt.current = ts;
      const sp = posR.current;

      setVs(prev => {
        const occ = {};
        prev.forEach(s => {
          const v = vr.current.find(x => x.id === s.id);
          if (!v || !v.active || v.route.length < 2) return;
          const nri = s.ri + 1;
          if (nri >= v.route.length) return;
          const key = `${v.route[s.ri]}-${v.route[nri]}`;
          if (!occ[key]) occ[key] = [];
          occ[key].push({ id: v.id, prog: s.prog });
        });

        return prev.map(s => {
          const v = vr.current.find(x => x.id === s.id);
          if (!v || !v.active || v.route.length < 2) return s;

          if (s.wait > 0) {
            const alpha = Math.min(1, dt * 5);
            const tx = s.park ? s.park.x : s.pos.x;
            const ty = s.park ? s.park.y : s.pos.y;
            return {
              ...s,
              wait: Math.max(0, s.wait - dt),
              pos: { x: s.pos.x + (tx - s.pos.x) * alpha, y: s.pos.y + (ty - s.pos.y) * alpha },
            };
          }

          const nri = s.ri + 1;
          if (nri >= v.route.length) {
            if (v.mode === "loop")     return { ...s, ri: 0, prog: 0, wait: 0.4 };
            if (v.mode === "ondemand") return { ...s, ri: 0, prog: 0, wait: 3 };
            return { ...s, ri: 0, prog: 0, wait: 1 };
          }

          const fromId = v.route[s.ri], toId = v.route[nri];
          const segLen = segDist(fromId, toId, sp);

          const key   = `${fromId}-${toId}`;
          const ahead = (occ[key] || []).filter(o => o.id !== v.id && o.prog > s.prog);
          const gap   = ahead.length ? Math.min(...ahead.map(o => o.prog)) - s.prog : 1;
          const adv   = Math.min((v.speed * 60 * dt) / (segLen || 1), Math.max(0, gap - 0.05));

          const np = s.prog + adv;
          if (np >= 1) {
            addLog(`${v.name} → ${STOPS[toId].name}`);
            const parkLane = lanePos(fromId, toId, 1.0, sp);
            const dx = sp[toId].x - sp[fromId].x, dy = sp[toId].y - sp[fromId].y;
            const len = Math.hypot(dx, dy) || 1;
            const PARK_OVERSHOOT = 18;
            const park = {
              x: parkLane.x + (dx / len) * PARK_OVERSHOOT,
              y: parkLane.y + (dy / len) * PARK_OVERSHOOT,
            };
            return { ...s, ri: nri, prog: 0, pos: lanePos(fromId, toId, 1.0, sp), park, wait: 0.4 };
          }
          return { ...s, prog: np, pos: lanePos(fromId, toId, np, sp), park: null };
        });
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spd, addLog]);

  // ── Stop node drag ────────────────────────────────────────────────────────
  const handleStopMouseDown = useCallback((e, id) => {
    e.stopPropagation();
    const svg = e.currentTarget.closest("svg");
    const rect = svg.getBoundingClientRect();
    const scaleX = 720 / rect.width, scaleY = 430 / rect.height;
    dragRef.current = {
      id,
      ox: (e.clientX - rect.left) * scaleX - posR.current[id].x,
      oy: (e.clientY - rect.top)  * scaleY - posR.current[id].y,
    };
  }, []);

  const handleSvgMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = 720 / rect.width, scaleY = 430 / rect.height;
    const x = Math.max(20, Math.min(700, (e.clientX - rect.left) * scaleX - dragRef.current.ox));
    const y = Math.max(20, Math.min(410, (e.clientY - rect.top)  * scaleY - dragRef.current.oy));
    setStopPos(prev => ({ ...prev, [dragRef.current.id]: { x, y } }));
  }, []);

  const handleSvgMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  // Switching to cfg always syncs localDefs with current defs
  const handleTabChange = (t) => {
    if (t === "cfg") {
      setLocalDefs(defs);
      // If a vehicle is selected, pre-select it in the editor
      if (sel) setEditId(sel);
    }
    setTab(t);
  };

  const selV    = sel ? vehicles.find(v => v.id === sel) : null;
  const editDef = localDefs.find(d => d.id === editId) || localDefs[0];
  const updE    = (f, val) => setLocalDefs(p => p.map(d => d.id === editId ? { ...d, [f]: val } : d));

  const save = () => {
    const newVehicles = buildVehicles(localDefs);
    setDefs(localDefs);
    setVs(p => p.map((s, i) => {
      const v = newVehicles.find(x => x.id === s.id);
      // Reset each vehicle to the start of its (new) route and stagger starts
      // so they don't all overlap at the same position simultaneously
      const startPos = v && v.route.length >= 2
        ? lanePos(v.route[0], v.route[1], 0, stopPos)
        : s.pos;
      return { ...s, ri: 0, prog: 0, wait: i * 0.8, pos: startPos, park: null };
    }));
    setTab("map");
  };

  // Only update defs — vehicles is derived via useMemo, always in sync
  const toggleActive = id => {
    setDefs(p => p.map(d => d.id === id ? { ...d, active: !d.active } : d));
  };

  const beds = [
    { fromId:"A", toId:"B" },
    { fromId:"B", toId:"C" },
    { fromId:"B", toId:"D" },
    { fromId:"C", toId:"D" },
  ];

  return (
    <div style={{ background:"#0a0f1e", height:"100vh", display:"flex", flexDirection:"column",
                  fontFamily:"system-ui,sans-serif", color:"#e2e8f0", overflow:"hidden" }}>

      {/* ── Header ── */}
      <div style={{ background:"#111827", borderBottom:"1px solid #1f2937", padding:"7px 12px",
                    display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#38bdf8" }}>🚗 iino Simulator</span>
        <div style={{ display:"flex", gap:2, marginLeft:"auto" }}>
          {[["map","マップ"],["cfg","設定"],["log","ログ"]].map(([t,l]) => (
            <button key={t} onClick={() => handleTabChange(t)} style={{
              padding:"4px 10px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
              background:tab===t?"#38bdf8":"#1f2937", color:tab===t?"#0a0f1e":"#94a3b8", fontWeight:600
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontSize:10, color:"#475569" }}>×{spd.toFixed(1)}</span>
          <input type="range" min={0.1} max={2} step={0.1} value={spd}
            onChange={e => { lt.current = null; setSpd(+e.target.value); }} style={{ width:55 }}/>
        </div>
      </div>

      {/* ── Map tab ── */}
      {tab === "map" && (
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          <div style={{ flex:1, position:"relative", minWidth:0 }}>
            <svg width="100%" height="100%" viewBox="0 0 720 430"
                 preserveAspectRatio="xMidYMid meet" style={{ display:"block" }}
                 onMouseMove={handleSvgMouseMove}
                 onMouseUp={handleSvgMouseUp}
                 onMouseLeave={handleSvgMouseUp}>
              <rect width="720" height="430" fill="#0a0f1e"/>
              {/* Grid */}
              {Array.from({length:18}).map((_,i)=>
                <line key={`v${i}`} x1={i*40} y1={0} x2={i*40} y2={430} stroke="#0d1424" strokeWidth={1}/>)}
              {Array.from({length:11}).map((_,i)=>
                <line key={`h${i}`} x1={0} y1={i*40} x2={720} y2={i*40} stroke="#0d1424" strokeWidth={1}/>)}

              {/* Road beds */}
              {beds.map(b => <RoadBed key={`bed-${b.fromId}-${b.toId}`} {...b} sp={stopPos}/>)}

              {/* One-way lanes */}
              {DIRECTED_EDGES.map(e => (
                <DirectedLane key={`ln-${e.from}-${e.to}`} fromId={e.from} toId={e.to} color="#1e3a2f" sp={stopPos}/>
              ))}

              {/* Stop nodes — draggable, rendered before vehicles so vehicles appear on top */}
              {Object.values(STOPS).map(s => (
                <g key={s.id} style={{ cursor:"grab" }}
                   onMouseDown={(e) => handleStopMouseDown(e, s.id)}>
                  <circle cx={stopPos[s.id].x} cy={stopPos[s.id].y}
                    r={s.type==="station"?20:15}
                    fill="#111827" stroke={SC[s.type]} strokeWidth={2.5}/>
                  <text x={stopPos[s.id].x} y={stopPos[s.id].y+1}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={SC[s.type]} fontSize={11} fontWeight="800"
                    style={{ userSelect:"none", pointerEvents:"none" }}>{s.id}</text>
                  <text x={stopPos[s.id].x} y={stopPos[s.id].y+30}
                    textAnchor="middle"
                    fill="#9ca3af" fontSize={10} fontWeight="500"
                    style={{ userSelect:"none", pointerEvents:"none" }}>{s.name}</text>
                </g>
              ))}

              {/* Vehicles */}
              {vs.map(s => {
                const v = vehicles.find(x => x.id === s.id);
                if (!v || !v.active) return null;
                const px = s.pos.x, py = s.pos.y;
                const isParked = s.wait > 0;
                return (
                  <g key={v.id} style={{ cursor:"pointer" }}
                     onClick={() => setSel(v.id === sel ? null : v.id)}>
                    {sel === v.id &&
                      <circle cx={px} cy={py} r={20} fill={v.color} fillOpacity={0.15}/>}
                    <circle cx={px} cy={py} r={11}
                      fill={v.color} stroke={sel===v.id?"#fff":"#0a0f1e"}
                      strokeWidth={sel===v.id?2.5:1.5} opacity={isParked?0.75:1}/>
                    <text x={px} y={py+1} textAnchor="middle" dominantBaseline="middle"
                      fill="#fff" fontSize={8} fontWeight="700"
                      style={{ userSelect:"none", pointerEvents:"none" }}>{v.id}</text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div style={{ position:"absolute", top:8, left:8, background:"rgba(17,24,39,0.92)",
                          borderRadius:6, padding:"7px 10px", border:"1px solid #1f2937", fontSize:10 }}>
              {Object.entries(MC).map(([m,c]) => (
                <div key={m} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                  <div style={{ width:14, height:2, background:c }}/>
                  <span style={{ color:"#94a3b8" }}>{ML[m]}</span>
                </div>
              ))}
              <div style={{ borderTop:"1px solid #1f2937", marginTop:5, paddingTop:5, color:"#475569", fontSize:9 }}>
                ▶ 一方通行レーン
              </div>
              <div style={{ color:"#475569", fontSize:9, marginTop:3 }}>
                ⠿ 地点はドラッグで移動
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ width:190, background:"#111827", borderLeft:"1px solid #1f2937",
                        display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ fontSize:10, color:"#475569", padding:"8px 10px 5px",
                          borderBottom:"1px solid #1f2937" }}>車両一覧</div>
            <div style={{ flex:1, overflowY:"auto", padding:"6px" }}>
              {vehicles.map(v => {
                const s   = vs.find(x => x.id === v.id);
                const ri  = s ? Math.min(s.ri, v.route.length - 1) : 0;
                const cur = STOPS[v.route[ri]]?.name ?? "—";
                return (
                  <div key={v.id} onClick={() => setSel(v.id === sel ? null : v.id)} style={{
                    padding:"7px 8px", borderRadius:6, cursor:"pointer", marginBottom:4,
                    background:sel===v.id?"#1e3a5f":"#1a2535",
                    border:`1px solid ${sel===v.id?v.color:"#1f2937"}`
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%",
                                    background:v.active?v.color:"#4b5563", flexShrink:0 }}/>
                      <span style={{ fontSize:11, fontWeight:600,
                                     color:v.active?"#e2e8f0":"#4b5563" }}>{v.name}</span>
                    </div>
                    <div style={{ fontSize:9, color:v.active?MC[v.mode]:"#374151" }}>{ML[v.mode]}</div>
                    {v.active && <div style={{ fontSize:9, color:"#6b7280", marginTop:2 }}>📍 {cur}</div>}
                  </div>
                );
              })}
            </div>
            {selV && (
              <div style={{ padding:"8px", borderTop:"1px solid #1f2937",
                            display:"flex", flexDirection:"column", gap:6 }}>
                <button onClick={() => toggleActive(selV.id)} style={{
                  padding:"7px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
                  background:selV.active?"#7f1d1d":"#14532d",
                  color:selV.active?"#fca5a5":"#86efac", fontWeight:600
                }}>{selV.active?"⏹ 停止":"▶ 稼働"}</button>
                <button onClick={() => { setEditId(selV.id); setLocalDefs(defs); setTab("cfg"); }} style={{
                  padding:"7px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
                  background:"#1e3a5f", color:"#93c5fd", fontWeight:600
                }}>✏️ 経路編集</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Config tab ── */}
      {tab === "cfg" && editDef && (
        <div style={{ flex:1, overflow:"auto", padding:12 }}>
          <div style={{ display:"flex", gap:4, overflowX:"auto", marginBottom:12, paddingBottom:4 }}>
            {localDefs.map(d => (
              <button key={d.id} onClick={() => setEditId(d.id)} style={{
                flexShrink:0, padding:"4px 8px", borderRadius:4, fontSize:11, cursor:"pointer",
                border:`1px solid ${editId===d.id?d.color:"#1f2937"}`,
                background:editId===d.id?"#1e3a5f":"#111827",
                color:editId===d.id?d.color:"#6b7280"
              }}>{d.name}</button>
            ))}
          </div>
          <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>名前</label>
                <input value={editDef.name} onChange={e => updE("name", e.target.value)} style={{
                  width:"100%", padding:"6px 8px", background:"#0a0f1e",
                  border:"1px solid #1f2937", borderRadius:4, color:"#e2e8f0",
                  fontSize:12, boxSizing:"border-box"
                }}/>
              </div>
              <div>
                <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>モード</label>
                <select value={editDef.mode} onChange={e => updE("mode", e.target.value)} style={{
                  width:"100%", padding:"6px 8px", background:"#0a0f1e",
                  border:"1px solid #1f2937", borderRadius:4, color:"#e2e8f0", fontSize:11
                }}>
                  <option value="loop">ループ</option>
                  <option value="ondemand">オンデマンド</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>
                速度 ×{editDef.speed}
              </label>
              <input type="range" min={0.2} max={2} step={0.2} value={editDef.speed}
                onChange={e => updE("speed", +e.target.value)} style={{ width:"100%" }}/>
            </div>
            <div>
              <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>カラー</label>
              <input type="color" value={editDef.color} onChange={e => updE("color", e.target.value)}
                style={{ width:60, height:30, padding:2, background:"#0a0f1e",
                         border:"1px solid #1f2937", borderRadius:4, cursor:"pointer" }}/>
            </div>
          </div>

          <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
            <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:4 }}>
              経由地（一方通行に沿って自動補間）
            </label>
            <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>
              有効な一方通行: A→B→C→D→B→A
            </div>
            <div style={{ fontSize:9, color:"#38bdf8", marginBottom:8, lineHeight:1.6 }}>
              展開後: {expandRoute(editDef.waypoints).join(" → ") || "（経路なし）"}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8, minHeight:32 }}>
              {editDef.waypoints.map((sid, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:2,
                                      background:"#0a0f1e", borderRadius:4, padding:"3px 7px", fontSize:11 }}>
                  {i > 0 && <span style={{ color:"#374151", marginRight:2 }}>→</span>}
                  <span style={{ color:SC[STOPS[sid]?.type||"stop"], fontWeight:700 }}>{sid}</span>
                  <span style={{ color:"#4b5563", fontSize:9, marginLeft:2 }}>{STOPS[sid]?.name}</span>
                  <button onClick={() => updE("waypoints", editDef.waypoints.filter((_,j)=>j!==i))}
                    style={{ background:"none", border:"none", color:"#ef4444",
                             cursor:"pointer", padding:0, fontSize:13, marginLeft:2 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {Object.values(STOPS).map(s => (
                <button key={s.id}
                  onClick={() => updE("waypoints", [...editDef.waypoints, s.id])} style={{
                    padding:"4px 10px", borderRadius:4,
                    border:`1px solid ${SC[s.type]}`,
                    background:"transparent", color:SC[s.type], cursor:"pointer", fontSize:11
                  }}>{s.id} <span style={{ fontSize:9, opacity:0.7 }}>{s.name}</span></button>
              ))}
            </div>
          </div>

          <button onClick={save} style={{
            width:"100%", padding:"10px", background:"#38bdf8", color:"#0a0f1e",
            border:"none", borderRadius:6, cursor:"pointer", fontWeight:700, fontSize:13
          }}>💾 保存して適用</button>
        </div>
      )}

      {/* ── Log tab ── */}
      {tab === "log" && (
        <div style={{ flex:1, padding:12, overflow:"auto" }}>
          <div style={{ fontSize:11, color:"#475569", marginBottom:8 }}>移動ログ</div>
          {logs.map((l, i) => (
            <div key={i} style={{ fontSize:11, color:"#94a3b8", padding:"3px 0",
                                  borderBottom:"1px solid #1f2937" }}>
              <span style={{ color:"#374151", marginRight:8 }}>{new Date(l.t).toLocaleTimeString()}</span>
              {l.m}
            </div>
          ))}
          {!logs.length && <div style={{ color:"#374151", fontSize:11 }}>まだログなし</div>}
        </div>
      )}
    </div>
  );
}
