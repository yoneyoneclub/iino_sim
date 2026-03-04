import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── localStorage helper ───────────────────────────────────────────────────────
function loadLS(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch { return fallback; }
}

// ─── Road topology ────────────────────────────────────────────────────────────
const STOPS_INIT = [
  { id:"A", name:"Info",   type:"station" },
  { id:"B", name:"改札",   type:"gate"    },
  { id:"C", name:"ホテル", type:"stop"    },
  { id:"D", name:"商業",   type:"stop"    },
];

const DIRECTED_EDGES = [
  { from:"A", to:"B" }, { from:"B", to:"A" },
  { from:"B", to:"C" }, { from:"C", to:"B" },
  { from:"B", to:"D" }, { from:"D", to:"B" },
  { from:"C", to:"D" }, { from:"D", to:"C" },
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

// ─── Character colors ─────────────────────────────────────────────────────────
// 1-5: kiha/subi/teyu/mete/kito  6-10: roha/hemi/colu/nere/yako
const CHAR_COLORS = [
  "#FFE033", // kiha  - 黄
  "#3377EE", // subi  - 青
  "#F0F0F0", // teyu  - 灰
  "#FF8833", // mete  - 橙
  "#FF5555", // kito  - 赤ピンク
  "#55AAEE", // roha  - 水色
  "#33CC77", // hemi  - 緑
  "#9933CC", // colu  - 紫
  "#3377EE", // nere  - 青
  "#33CC77", // yako  - 緑
];

// ─── Vehicle definitions ──────────────────────────────────────────────────────
const CHAR_NAMES = ["kiha","subi","teyu","mete","kito","roha","hemi","colu","nere","yako"];

const VEHICLE_DEFS = [
  { id:1,  name:"kiha", mode:"loop", waypoints:["A","B","A"], color:"#FFE033", speed:0.8, active:true },
  { id:2,  name:"subi", mode:"loop", waypoints:["A","B","A"], color:"#3377EE", speed:0.6, active:true },
  { id:3,  name:"teyu", mode:"loop", waypoints:["A","B","A"], color:"#F0F0F0", speed:0.7, active:true },
  { id:4,  name:"mete", mode:"loop", waypoints:["A","B","A"], color:"#FF8833", speed:0.9, active:true },
  { id:5,  name:"kito", mode:"loop", waypoints:["A","B","A"], color:"#FF5555", speed:0.8, active:true },
  { id:6,  name:"roha", mode:"loop", waypoints:["A","D","A"], color:"#55AAEE", speed:0.8, active:true },
  { id:7,  name:"hemi", mode:"loop", waypoints:["A","C","A"], color:"#33CC77", speed:0.8, active:true },
  { id:8,  name:"colu", mode:"loop", waypoints:["A","B","A"], color:"#9933CC", speed:0.7, active:true },
  { id:9,  name:"nere", mode:"loop", waypoints:["A","B","A"], color:"#3377EE", speed:0.6, active:true },
  { id:10, name:"yako", mode:"loop", waypoints:["A","B","A"], color:"#33CC77", speed:0.9, active:true },
];

function buildVehicles(defs) {
  return defs.map(d => ({ ...d, route: expandRoute(d.waypoints) }));
}

// Luminance check → dark text on light vehicle badges
function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 160;
}

const MC = { loop:"#22c55e", detour:"#f59e0b", ondemand:"#8b5cf6" };
const ML = { loop:"ループ",  detour:"寄り道",  ondemand:"オンデマンド" };
const SC = { station:"#3b82f6", gate:"#ef4444", terminal:"#f97316", stop:"#64748b" };
const ST = { station:"ステーション", gate:"ゲート", terminal:"ターミナル", stop:"停留所" };

let paxIdCounter = 1;

// ─── Road rendering ───────────────────────────────────────────────────────────
function DirectedLane({ fromId, toId, sp }) {
  const fx = sp[fromId].x, fy = sp[fromId].y, tx = sp[toId].x, ty = sp[toId].y;
  const { ox, oy } = laneVec(fromId, toId, sp);
  const x1 = fx+ox, y1 = fy+oy, x2 = tx+ox, y2 = ty+oy;
  const dx = tx-fx, dy = ty-fy, len = Math.hypot(dx,dy)||1;
  const ux = dx/len, uy = dy/len;
  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const AW=7, AL=10;
  const ax=mx+ux*AL, ay=my+uy*AL;
  const bx=mx-ux*AL/2+uy*AW, by=my-uy*AL/2-ux*AW;
  const cx2=mx-ux*AL/2-uy*AW, cy2=my-uy*AL/2+ux*AW;
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1e3a2f" strokeWidth={LANE*1.8} strokeLinecap="round"/>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0a0f1e" strokeWidth={1} strokeOpacity={0.4}/>
      <polygon points={`${ax},${ay} ${bx},${by} ${cx2},${cy2}`} fill="#fff" opacity={0.18}/>
    </g>
  );
}

function RoadBed({ fromId, toId, sp }) {
  return <line x1={sp[fromId].x} y1={sp[fromId].y} x2={sp[toId].x} y2={sp[toId].y}
    stroke="#161f30" strokeWidth={LANE*4.5} strokeLinecap="round"/>;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [defs,          setDefs]          = useState(() => loadLS("iino_defs", VEHICLE_DEFS));
  const vehicles = useMemo(() => buildVehicles(defs), [defs]);

  const [stopPos,       setStopPos]       = useState(() => loadLS("iino_stopPos", INIT_STOP_POS));
  const [stopDefs,      setStopDefs]      = useState(() => loadLS("iino_stopDefs", STOPS_INIT));
  const stopsMap = useMemo(() => Object.fromEntries(stopDefs.map(s => [s.id, s])), [stopDefs]);

  const [vs,            setVs]            = useState(() => {
    const initDefs = loadLS("iino_defs", VEHICLE_DEFS);
    const initPos  = loadLS("iino_stopPos", INIT_STOP_POS);
    return buildVehicles(initDefs).map((v, i) => ({
      id: v.id, ri:0, prog:0,
      pos: { x: initPos[v.route[0]]?.x ?? 100, y: initPos[v.route[0]]?.y ?? 100 },
      park: null, wait: i * 1.1,
      obstacleTimer: 0, obstacleType: null,
      customRoute: null, pickupStop: null,
    }));
  });

  const [sel,           setSel]           = useState(null);
  const [tab,           setTab]           = useState("map");
  const [spd,           setSpd]           = useState(0.5);
  const [logs,          setLogs]          = useState([]);
  const [editId,        setEditId]        = useState(() => loadLS("iino_defs", VEHICLE_DEFS)[0]?.id ?? 1);
  const [localDefs,     setLocalDefs]     = useState(() => loadLS("iino_defs", VEHICLE_DEFS));
  const [localStopDefs, setLocalStopDefs] = useState(() => loadLS("iino_stopDefs", STOPS_INIT));
  const [cfgSub,        setCfgSub]        = useState("vehicle");
  const [pedDensity,    setPedDensity]    = useState(0.3);
  const [maxStop,       setMaxStop]       = useState(5);
  const [passengers,    setPassengers]    = useState([]);
  const [autoDis,       setAutoDis]       = useState(true);

  const dragRef      = useRef(null);
  const lt           = useRef(null);
  const vrRef        = useRef(vehicles);   vrRef.current      = vehicles;
  const posR         = useRef(stopPos);    posR.current       = stopPos;
  const stopsMapR    = useRef(stopsMap);   stopsMapR.current  = stopsMap;
  const vsR          = useRef(vs);         vsR.current        = vs;
  const paxR         = useRef(passengers); paxR.current       = passengers;
  const spdR         = useRef(spd);        spdR.current       = spd;
  const pedR         = useRef(pedDensity); pedR.current       = pedDensity;
  const maxStopR     = useRef(maxStop);    maxStopR.current   = maxStop;
  const autoDisR     = useRef(autoDis);    autoDisR.current   = autoDis;
  const paxTimerR    = useRef(Math.random() * 8 + 6);

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = ts => {
      if (!lt.current) lt.current = ts;
      const dt = Math.min((ts - lt.current) / 1000, 0.05) * spdR.current;
      lt.current = ts;
      const sp = posR.current;

      // Passenger spawn
      let newPax = null;
      let dispatchVid = null;
      const newLogs = [];

      paxTimerR.current -= dt;
      if (paxTimerR.current <= 0) {
        paxTimerR.current = Math.random() * 10 + 5;
        const weights = { A:1, B:2, C:5, D:2 };
        let r = Math.random() * 10, spawnStop = "C";
        for (const [sid, w] of Object.entries(weights)) { r -= w; if (r <= 0) { spawnStop = sid; break; } }
        newPax = { id: paxIdCounter++, stopId: spawnStop, status: "waiting" };
        newLogs.push(`🧍 ${stopsMapR.current[spawnStop]?.name || spawnStop}に乗客が発生`);
        if (autoDisR.current) {
          const tPos = sp[spawnStop];
          let best = null, bestDist = Infinity;
          for (const s of vsR.current) {
            const v = vrRef.current.find(x => x.id === s.id);
            if (!v || !v.active || s.pickupStop) continue;
            const d = Math.hypot(s.pos.x - tPos.x, s.pos.y - tPos.y);
            if (d < bestDist) { bestDist = d; best = s; }
          }
          if (best) {
            dispatchVid = best.id;
            const vname = vrRef.current.find(x => x.id === best.id)?.name || `id${best.id}`;
            newLogs.push(`🚗 ${vname} → ${stopsMapR.current[spawnStop]?.name || spawnStop}へ出動`);
          }
        }
      }

      // Occupancy map
      const prevVs = vsR.current;
      const occ = {};
      prevVs.forEach(s => {
        const v = vrRef.current.find(x => x.id === s.id);
        if (!v || !v.active) return;
        const route = s.customRoute || v.route;
        if (route.length < 2) return;
        const nri = s.ri + 1;
        if (nri >= route.length) return;
        const key = `${route[s.ri]}-${route[nri]}`;
        if (!occ[key]) occ[key] = [];
        occ[key].push({ id: v.id, prog: s.prog });
      });

      const pickupEvents = [];

      const nextVs = prevVs.map(s => {
        const v = vrRef.current.find(x => x.id === s.id);
        if (!v || !v.active) return s;
        let route = s.customRoute || v.route;

        // Apply dispatch
        if (dispatchVid === s.id && newPax) {
          const curStop = route[Math.min(s.ri, route.length-1)];
          const toPickup = shortestPath(curStop, newPax.stopId) || [curStop, newPax.stopId];
          const toEnd = shortestPath(newPax.stopId, v.waypoints[v.waypoints.length-1]) || [newPax.stopId];
          const dr = [...toPickup, ...toEnd.slice(1)];
          return { ...s, customRoute: dr, pickupStop: newPax.stopId, ri:0, prog:0 };
        }

        if (route.length < 2) return s;

        // Obstacle
        let { obstacleTimer, obstacleType } = s;
        if (obstacleTimer > 0) {
          obstacleTimer = Math.max(0, obstacleTimer - dt);
          if (obstacleTimer === 0) obstacleType = null;
        } else {
          if (Math.random() < pedR.current * 0.01) {
            obstacleTimer = Math.random() * maxStopR.current + 0.5;
            obstacleType  = Math.random() < 0.5 ? "stop" : "slow";
          }
        }
        if (obstacleType === "stop" && obstacleTimer > 0)
          return { ...s, obstacleTimer, obstacleType };

        // Wait
        if (s.wait > 0) {
          const alpha = Math.min(1, dt * 5);
          const tx = s.park ? s.park.x : s.pos.x;
          const ty = s.park ? s.park.y : s.pos.y;
          return { ...s, wait: Math.max(0, s.wait - dt), obstacleTimer, obstacleType,
            pos: { x: s.pos.x+(tx-s.pos.x)*alpha, y: s.pos.y+(ty-s.pos.y)*alpha } };
        }

        const nri = s.ri + 1;
        if (nri >= route.length) {
          if (s.pickupStop) pickupEvents.push({ stopId: s.pickupStop, done: true });
          if (v.mode === "loop") return { ...s, ri:0, prog:0, wait:0.4, customRoute:null, pickupStop:null, obstacleTimer, obstacleType };
          if (v.mode === "ondemand") return { ...s, ri:0, prog:0, wait:3, customRoute:null, pickupStop:null, obstacleTimer, obstacleType };
          return { ...s, ri:0, prog:0, wait:1, customRoute:null, pickupStop:null, obstacleTimer, obstacleType };
        }

        const fromId = route[s.ri], toId = route[nri];
        const segLen = segDist(fromId, toId, sp);
        const key    = `${fromId}-${toId}`;
        const ahead  = (occ[key]||[]).filter(o => o.id !== v.id && o.prog > s.prog);
        const gap    = ahead.length ? Math.min(...ahead.map(o => o.prog)) - s.prog : 1;
        const sf     = (obstacleType === "slow" && obstacleTimer > 0) ? 0.35 : 1.0;
        const adv    = Math.min((v.speed*60*dt*sf)/(segLen||1), Math.max(0, gap-0.05));
        const np     = s.prog + adv;

        if (np >= 1) {
          if (s.pickupStop && toId === s.pickupStop)
            pickupEvents.push({ stopId: s.pickupStop, done: false });
          newLogs.push(`${v.name} → ${stopsMapR.current[toId]?.name ?? toId}`);
          const parkLane = lanePos(fromId, toId, 1.0, sp);
          const dx = sp[toId].x-sp[fromId].x, dy = sp[toId].y-sp[fromId].y;
          const len = Math.hypot(dx,dy)||1;
          const park = { x: parkLane.x+(dx/len)*18, y: parkLane.y+(dy/len)*18 };
          const waitTime = (s.pickupStop && toId === s.pickupStop) ? 2.5 : 0.4;
          return { ...s, ri:nri, prog:0, pos:lanePos(fromId,toId,1.0,sp), park, wait:waitTime, obstacleTimer, obstacleType };
        }
        return { ...s, prog:np, pos:lanePos(fromId,toId,np,sp), park:null, obstacleTimer, obstacleType };
      });

      pickupEvents.forEach(e => {
        newLogs.push(e.done
          ? `✅ 配車完了: ${stopsMapR.current[e.stopId]?.name || e.stopId}`
          : `🧍→🚗 ${stopsMapR.current[e.stopId]?.name || e.stopId}で乗車`);
      });

      vsR.current = nextVs;
      setVs(nextVs);

      if (newPax || pickupEvents.length) {
        const nextPax = (() => {
          let p = paxR.current.filter(x => x.status !== "done");
          if (newPax) p = [...p, newPax];
          pickupEvents.forEach(e => {
            if (!e.done) p = p.map(x => x.stopId===e.stopId&&x.status==="waiting" ? {...x,status:"boarding"} : x);
            else         p = p.map(x => x.stopId===e.stopId&&x.status==="boarding" ? {...x,status:"done"} : x);
          });
          return p;
        })();
        paxR.current = nextPax;
        setPassengers(nextPax);
      }

      if (newLogs.length)
        setLogs(prev => [...newLogs.map(m => ({ t:Date.now(), m })), ...prev].slice(0, 80));

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Stop drag (RAF-throttled) ────────────────────────────────────────────────
  const handleStopMouseDown = useCallback((e, id) => {
    e.stopPropagation();
    const svg = e.currentTarget.closest("svg");
    const rect = svg.getBoundingClientRect();
    const sx = 720/rect.width, sy = 430/rect.height;
    dragRef.current = {
      id,
      ox: (e.clientX-rect.left)*sx - posR.current[id].x,
      oy: (e.clientY-rect.top)*sy  - posR.current[id].y,
    };
  }, []);

  const handleSvgMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = 720/rect.width, sy = 430/rect.height;
    dragRef.current.pendingX = Math.max(20, Math.min(700, (e.clientX-rect.left)*sx - dragRef.current.ox));
    dragRef.current.pendingY = Math.max(20, Math.min(410, (e.clientY-rect.top)*sy  - dragRef.current.oy));
    if (!dragRef.current.rafId) {
      dragRef.current.rafId = requestAnimationFrame(() => {
        if (dragRef.current) {
          const { id, pendingX: x, pendingY: y } = dragRef.current;
          setStopPos(prev => ({ ...prev, [id]: { x, y } }));
          dragRef.current.rafId = null;
        }
      });
    }
  }, []);

  const handleSvgMouseUp = useCallback(() => {
    if (dragRef.current)
      localStorage.setItem("iino_stopPos", JSON.stringify(posR.current));
    dragRef.current = null;
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleTabChange = t => {
    if (t === "cfg") { setLocalDefs(defs); setLocalStopDefs(stopDefs); if (sel) setEditId(sel); }
    setTab(t);
  };

  const selV    = sel ? vehicles.find(v => v.id === sel) : null;
  const editDef = localDefs.find(d => d.id === editId) || localDefs[0];
  const updE    = (f, val) => setLocalDefs(p => p.map(d => d.id === editId ? { ...d, [f]: val } : d));

  const addVehicle = () => {
    const maxId = Math.max(0, ...localDefs.map(d => d.id));
    const newId = maxId + 1;
    const newDef = {
      id: newId, name: CHAR_NAMES[(newId-1) % CHAR_NAMES.length] || `iino-${String(newId).padStart(2,"0")}`,
      mode: "loop", waypoints: ["A","B","A"],
      color: CHAR_COLORS[(newId-1) % CHAR_COLORS.length],
      speed: 0.8, active: true,
    };
    setLocalDefs(p => [...p, newDef]);
    setEditId(newId);
  };

  const removeVehicle = id => {
    setLocalDefs(p => {
      const next = p.filter(d => d.id !== id);
      if (editId === id && next.length > 0) setEditId(next[0].id);
      return next;
    });
  };

  const save = () => {
    const nv = buildVehicles(localDefs);
    setDefs(localDefs);
    setStopDefs(localStopDefs);
    localStorage.setItem("iino_defs",     JSON.stringify(localDefs));
    localStorage.setItem("iino_stopPos",  JSON.stringify(stopPos));
    localStorage.setItem("iino_stopDefs", JSON.stringify(localStopDefs));
    setVs(prev => {
      const byId = Object.fromEntries(prev.map(s => [s.id, s]));
      return nv.map((v, i) => {
        const startPos = v.route.length >= 2
          ? lanePos(v.route[0], v.route[1], 0, stopPos)
          : { x: stopPos[v.route[0]]?.x ?? 100, y: stopPos[v.route[0]]?.y ?? 100 };
        const ex = byId[v.id];
        return ex
          ? { ...ex, ri:0, prog:0, wait:i*0.8, pos:startPos, park:null, customRoute:null, pickupStop:null }
          : { id:v.id, ri:0, prog:0, pos:startPos, park:null, wait:i*0.8, obstacleTimer:0, obstacleType:null, customRoute:null, pickupStop:null };
      });
    });
    setTab("map");
  };

  const toggleActive = id => {
    setDefs(p => {
      const next = p.map(d => d.id === id ? { ...d, active: !d.active } : d);
      localStorage.setItem("iino_defs", JSON.stringify(next));
      return next;
    });
  };

  const dispatchTo = (vid, stopId) => {
    const s = vsR.current.find(x => x.id === vid);
    const v = vehicles.find(x => x.id === vid);
    if (!s || !v) return;
    const route = s.customRoute || v.route;
    const curStop = route[Math.min(s.ri, route.length-1)];
    const toPickup = shortestPath(curStop, stopId) || [curStop, stopId];
    const toEnd = shortestPath(stopId, v.waypoints[v.waypoints.length-1]) || [stopId];
    const dr = [...toPickup, ...toEnd.slice(1)];
    setVs(prev => prev.map(x => x.id===vid ? { ...x, customRoute:dr, pickupStop:stopId, ri:0, prog:0 } : x));
    setLogs(p => [{ t:Date.now(), m:`📡 ${v.name}を${stopsMap[stopId]?.name||stopId}へ手動配車` }, ...p].slice(0,80));
  };

  const spawnPax = stopId => {
    const p = { id: paxIdCounter++, stopId, status:"waiting" };
    setPassengers(prev => [...prev.filter(x => x.status!=="done"), p]);
    setLogs(prev => [{ t:Date.now(), m:`🧍 ${stopsMap[stopId]?.name||stopId}に乗客（手動）` }, ...prev].slice(0,80));
    if (autoDis) {
      const tPos = posR.current[stopId];
      let best = null, bestDist = Infinity;
      for (const s of vsR.current) {
        const vd = vehicles.find(x => x.id === s.id);
        if (!vd || !vd.active || s.pickupStop) continue;
        const d = Math.hypot(s.pos.x-tPos.x, s.pos.y-tPos.y);
        if (d < bestDist) { bestDist = d; best = s; }
      }
      if (best) dispatchTo(best.id, stopId);
    }
  };

  const beds = [
    { fromId:"A", toId:"B" }, { fromId:"B", toId:"C" },
    { fromId:"B", toId:"D" }, { fromId:"C", toId:"D" },
  ];
  const waitingPax  = passengers.filter(p => p.status === "waiting");
  const boardingPax = passengers.filter(p => p.status === "boarding");

  const SliderRow = ({ label, value, min, max, step, unit, onChange }) => (
    <div style={{ marginBottom:7 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
        <span style={{ color:"#94a3b8", fontSize:10 }}>{label}</span>
        <span style={{ color:"#e2e8f0", fontSize:10 }}>{typeof value==="number"&&value%1!==0 ? value.toFixed(1) : value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)} style={{ width:"100%", accentColor:"#38bdf8" }}/>
    </div>
  );

  return (
    <div style={{ background:"#0a0f1e", height:"100vh", display:"flex", flexDirection:"column",
                  fontFamily:"system-ui,sans-serif", color:"#e2e8f0", overflow:"hidden" }}>

      {/* ── Header ── */}
      <div style={{ background:"#111827", borderBottom:"1px solid #1f2937", padding:"6px 12px",
                    display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#38bdf8" }}>🚗 iino Simulator</span>
        <div style={{ display:"flex", gap:2, marginLeft:"auto" }}>
          {[["map","マップ"],["cfg","設定"],["log","ログ"],["help","?"]].map(([t,l]) => (
            <button key={t} onClick={() => handleTabChange(t)} style={{
              padding:"4px 10px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
              background:tab===t?"#38bdf8":"#1f2937", color:tab===t?"#0a0f1e":"#94a3b8", fontWeight:600
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ fontSize:10, color:"#475569" }}>速度×{spd.toFixed(1)}</span>
          <input type="range" min={0.1} max={2} step={0.1} value={spd}
            onChange={e => { lt.current=null; setSpd(+e.target.value); spdR.current=+e.target.value; }}
            style={{ width:55, accentColor:"#38bdf8" }}/>
        </div>
      </div>

      {/* ── Map tab ── */}
      {tab === "map" && (
        <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
          <div style={{ flex:1, position:"relative", minWidth:0 }}>
            <svg width="100%" height="100%" viewBox="0 0 720 430"
                 preserveAspectRatio="xMidYMid meet" style={{ display:"block" }}
                 onMouseMove={handleSvgMouseMove} onMouseUp={handleSvgMouseUp} onMouseLeave={handleSvgMouseUp}>
              <rect width="720" height="430" fill="#0a0f1e"/>
              {Array.from({length:18}).map((_,i)=>
                <line key={`v${i}`} x1={i*40} y1={0} x2={i*40} y2={430} stroke="#0d1424" strokeWidth={1}/>)}
              {Array.from({length:11}).map((_,i)=>
                <line key={`h${i}`} x1={0} y1={i*40} x2={720} y2={i*40} stroke="#0d1424" strokeWidth={1}/>)}
              {beds.map(b => <RoadBed key={`bed-${b.fromId}-${b.toId}`} {...b} sp={stopPos}/>)}
              {DIRECTED_EDGES.map(e => (
                <DirectedLane key={`ln-${e.from}-${e.to}`} fromId={e.from} toId={e.to} sp={stopPos}/>
              ))}

              {/* Waiting passenger indicators */}
              {waitingPax.map((p, i) => {
                const sp2 = stopPos[p.stopId];
                return <text key={p.id}
                  x={sp2.x - 8 + (i%4)*10} y={sp2.y - 22 - Math.floor(i/4)*12}
                  fontSize={11} textAnchor="middle"
                  style={{ userSelect:"none", pointerEvents:"none" }}>🧍</text>;
              })}

              {/* Stop nodes */}
              {stopDefs.map(s => (
                <g key={s.id} style={{ cursor:"grab" }} onMouseDown={e => handleStopMouseDown(e, s.id)}>
                  <circle cx={stopPos[s.id]?.x} cy={stopPos[s.id]?.y} r={14}
                    fill="#111827" stroke={SC[s.type]} strokeWidth={2.5}/>
                  <text x={stopPos[s.id]?.x} y={(stopPos[s.id]?.y??0)+1}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={SC[s.type]} fontSize={11} fontWeight="800"
                    style={{ userSelect:"none", pointerEvents:"none" }}>{s.id}</text>
                  <text x={stopPos[s.id]?.x} y={(stopPos[s.id]?.y??0)+30}
                    textAnchor="middle" fill="#9ca3af" fontSize={10} fontWeight="500"
                    style={{ userSelect:"none", pointerEvents:"none" }}>{s.name}</text>
                </g>
              ))}

              {/* Vehicles */}
              {vs.map(s => {
                const v = vehicles.find(x => x.id === s.id);
                if (!v || !v.active) return null;
                const px=s.pos.x, py=s.pos.y;
                const isParked     = s.wait > 0;
                const isStopped    = s.obstacleType==="stop" && s.obstacleTimer>0;
                const isSlowed     = s.obstacleType==="slow" && s.obstacleTimer>0;
                const isDispatched = !!s.pickupStop;
                const textCol      = isLight(v.color) ? "#111" : "#fff";
                return (
                  <g key={v.id} style={{ cursor:"pointer" }}
                     onClick={() => setSel(v.id===sel ? null : v.id)}>
                    {sel===v.id && <circle cx={px} cy={py} r={21} fill={v.color} fillOpacity={0.15}/>}
                    {isDispatched && <circle cx={px} cy={py} r={15} fill="none" stroke="#a78bfa" strokeWidth={2} strokeDasharray="3 2"/>}
                    {isStopped    && <circle cx={px} cy={py} r={14} fill="none" stroke="#ef4444" strokeWidth={1.5} opacity={0.7}/>}
                    {isSlowed     && <circle cx={px} cy={py} r={14} fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.7}/>}
                    <circle cx={px} cy={py} r={11}
                      fill={v.color} stroke={sel===v.id?"#fff":"#0a0f1e"}
                      strokeWidth={sel===v.id?2.5:1.5} opacity={isParked?0.72:1}/>
                    <text x={px} y={py+1} textAnchor="middle" dominantBaseline="middle"
                      fill={textCol} fontSize={5.5} fontWeight="700"
                      style={{ userSelect:"none", pointerEvents:"none" }}>{v.name}</text>
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div style={{ position:"absolute", top:8, left:8,
                          background:"rgba(17,24,39,0.93)", borderRadius:6,
                          padding:"8px 10px", border:"1px solid #1f2937", fontSize:10 }}>
              <div style={{ color:"#38bdf8", fontWeight:700, marginBottom:5 }}>キャラクター</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6, maxWidth:140 }}>
                {VEHICLE_DEFS.map(d => (
                  <div key={d.id} style={{ display:"flex", alignItems:"center", gap:3 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:d.color,
                                  border: isLight(d.color) ? "1px solid #555" : "none" }}/>
                    <span style={{ color:"#94a3b8", fontSize:9 }}>{d.name}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                <div style={{ width:12,height:12,borderRadius:"50%",border:"1.5px solid #ef4444",background:"transparent"}}/>
                <span style={{ color:"#94a3b8" }}>歩行者停止</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
                <div style={{ width:12,height:12,borderRadius:"50%",border:"1.5px solid #f59e0b",background:"transparent"}}/>
                <span style={{ color:"#94a3b8" }}>歩行者減速</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <div style={{ width:12,height:12,borderRadius:"50%",border:"2px dashed #a78bfa",background:"transparent"}}/>
                <span style={{ color:"#94a3b8" }}>配車中</span>
              </div>
              <div style={{ borderTop:"1px solid #1f2937", paddingTop:4, color:"#475569", fontSize:9 }}>
                ⠿ 地点はドラッグで移動
              </div>
            </div>

            {/* Pedestrian controls */}
            <div style={{ position:"absolute", bottom:8, left:8,
                          background:"rgba(17,24,39,0.95)", borderRadius:6,
                          padding:"9px 11px", border:"1px solid #1f2937", minWidth:185 }}>
              <div style={{ color:"#38bdf8", fontWeight:700, fontSize:11, marginBottom:7 }}>🚶 歩行者・障害物</div>
              <SliderRow label="密度（障害物の頻度）" value={pedDensity} min={0} max={1} step={0.05} unit="%"
                onChange={v => { setPedDensity(v); pedR.current=v; }}/>
              <SliderRow label="最大停止・減速時間" value={maxStop} min={0.5} max={10} step={0.5} unit="秒"
                onChange={v => { setMaxStop(v); maxStopR.current=v; }}/>
            </div>

            {/* On-demand controls */}
            <div style={{ position:"absolute", bottom:8, left:220,
                          background:"rgba(17,24,39,0.95)", borderRadius:6,
                          padding:"9px 11px", border:"1px solid #1f2937", minWidth:190 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                <span style={{ color:"#38bdf8", fontWeight:700, fontSize:11 }}>🧍 乗客・配車</span>
                <label style={{ display:"flex", alignItems:"center", gap:3, cursor:"pointer", fontSize:9 }}>
                  <input type="checkbox" checked={autoDis}
                    onChange={e => { setAutoDis(e.target.checked); autoDisR.current=e.target.checked; }}
                    style={{ margin:0 }}/>
                  <span style={{ color:"#94a3b8" }}>自動配車</span>
                </label>
              </div>
              <div style={{ fontSize:10, marginBottom:6 }}>
                <span style={{ color:"#fbbf24" }}>待機: {waitingPax.length}人</span>
                {boardingPax.length > 0 && <span style={{ color:"#4ade80", marginLeft:8 }}>乗車中: {boardingPax.length}人</span>}
              </div>
              <div style={{ fontSize:9, color:"#475569", marginBottom:4 }}>手動で乗客発生:</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                {stopDefs.map(s => (
                  <button key={s.id} onClick={() => spawnPax(s.id)} style={{
                    padding:"3px 8px", borderRadius:3, border:`1px solid ${SC[s.type]}`,
                    background:"transparent", color:SC[s.type], cursor:"pointer", fontSize:9
                  }}>{s.name}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ width:195, background:"#111827", borderLeft:"1px solid #1f2937",
                        display:"flex", flexDirection:"column", overflow:"hidden" }}>
            <div style={{ fontSize:10, color:"#475569", padding:"8px 10px 5px",
                          borderBottom:"1px solid #1f2937" }}>車両一覧</div>
            <div style={{ flex:1, overflowY:"auto", padding:"6px" }}>
              {vehicles.map(v => {
                const s     = vs.find(x => x.id === v.id);
                const route = s?.customRoute || v.route;
                const ri    = s ? Math.min(s.ri, route.length-1) : 0;
                const cur   = stopsMap[route[ri]]?.name ?? "—";
                const isDis = !!s?.pickupStop;
                const isObs = s?.obstacleType && s.obstacleTimer > 0;
                return (
                  <div key={v.id} onClick={() => setSel(v.id===sel ? null : v.id)} style={{
                    padding:"7px 8px", borderRadius:6, cursor:"pointer", marginBottom:4,
                    background:sel===v.id?"#1e3a5f":"#1a2535",
                    border:`1px solid ${sel===v.id?v.color:"#1f2937"}`
                  }}>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
                                    background:v.active?v.color:"#4b5563",
                                    border: isLight(v.color) ? "1px solid #555" : "none" }}/>
                      <span style={{ fontSize:11, fontWeight:600, flex:1, overflow:"hidden",
                                     textOverflow:"ellipsis", whiteSpace:"nowrap",
                                     color:v.active?"#e2e8f0":"#4b5563" }}>{v.name}</span>
                      {isDis && <span style={{ fontSize:8, color:"#a78bfa", flexShrink:0 }}>配車</span>}
                      {isObs && <span style={{ fontSize:8, flexShrink:0,
                                               color:s.obstacleType==="stop"?"#ef4444":"#f59e0b" }}>
                        {s.obstacleType==="stop"?"停止":"減速"}</span>}
                    </div>
                    <div style={{ fontSize:9, color:v.active?MC[v.mode]:"#374151" }}>{ML[v.mode]}</div>
                    {v.active && <div style={{ fontSize:9, color:"#6b7280", marginTop:2 }}>📍 {cur}</div>}
                  </div>
                );
              })}
            </div>
            {selV && (
              <div style={{ padding:"8px", borderTop:"1px solid #1f2937",
                            display:"flex", flexDirection:"column", gap:4 }}>
                <button onClick={() => toggleActive(selV.id)} style={{
                  padding:"6px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
                  background:selV.active?"#7f1d1d":"#14532d",
                  color:selV.active?"#fca5a5":"#86efac", fontWeight:600
                }}>{selV.active?"⏹ 停止":"▶ 稼働"}</button>
                <button onClick={() => { setEditId(selV.id); setLocalDefs(defs); setTab("cfg"); }} style={{
                  padding:"6px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
                  background:"#1e3a5f", color:"#93c5fd", fontWeight:600
                }}>✏️ 経路編集</button>
                <div style={{ fontSize:9, color:"#475569" }}>配車先:</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                  {stopDefs.map(st => (
                    <button key={st.id} onClick={() => dispatchTo(selV.id, st.id)} style={{
                      padding:"3px 7px", borderRadius:3, border:`1px solid ${SC[st.type]}`,
                      background:"transparent", color:SC[st.type], cursor:"pointer", fontSize:9
                    }}>{st.name}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Config tab ── */}
      {tab === "cfg" && (
        <div style={{ flex:1, overflow:"auto", padding:12 }}>
          <div style={{ display:"flex", gap:4, marginBottom:12 }}>
            {[["vehicle","車両"],["stop","地点"]].map(([k,l]) => (
              <button key={k} onClick={() => setCfgSub(k)} style={{
                padding:"5px 14px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11, fontWeight:600,
                background:cfgSub===k?"#38bdf8":"#1f2937", color:cfgSub===k?"#0a0f1e":"#94a3b8"
              }}>{l}</button>
            ))}
          </div>

          {/* Vehicle sub-tab */}
          {cfgSub === "vehicle" && editDef && (<>
            <div style={{ display:"flex", gap:4, overflowX:"auto", marginBottom:12, paddingBottom:4, alignItems:"center" }}>
              {localDefs.map(d => (
                <button key={d.id} onClick={() => setEditId(d.id)} style={{
                  flexShrink:0, padding:"4px 8px", borderRadius:4, fontSize:11, cursor:"pointer",
                  border:`1px solid ${editId===d.id?d.color:"#1f2937"}`,
                  background:editId===d.id?"#1e3a5f":"#111827",
                  color:editId===d.id?d.color:"#6b7280"
                }}>{d.name}</button>
              ))}
              <button onClick={addVehicle} style={{
                flexShrink:0, padding:"4px 10px", borderRadius:4, fontSize:11, cursor:"pointer",
                border:"1px dashed #374151", background:"transparent", color:"#475569", fontWeight:700
              }}>＋</button>
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
                <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>速度 ×{editDef.speed}</label>
                <input type="range" min={0.2} max={2} step={0.2} value={editDef.speed}
                  onChange={e => updE("speed", +e.target.value)} style={{ width:"100%" }}/>
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:4 }}>カラー</label>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:6, maxWidth:220 }}>
                    {CHAR_COLORS.map((c, i) => (
                      <button key={c+i} onClick={() => updE("color", c)} style={{
                        width:22, height:22, background:c, borderRadius:4, cursor:"pointer",
                        border: editDef.color===c ? "2.5px solid #fff" : "2px solid transparent"
                      }}/>
                    ))}
                  </div>
                  <input type="color" value={editDef.color} onChange={e => updE("color", e.target.value)}
                    style={{ width:40, height:28, padding:2, background:"#0a0f1e",
                             border:"1px solid #1f2937", borderRadius:4, cursor:"pointer" }}/>
                </div>
                {localDefs.length > 1 && (
                  <button onClick={() => removeVehicle(editDef.id)} style={{
                    padding:"6px 12px", borderRadius:4, border:"1px solid #7f1d1d",
                    background:"transparent", color:"#ef4444", cursor:"pointer", fontSize:11, fontWeight:600
                  }}>× 削除</button>
                )}
              </div>
            </div>

            <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
              <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:4 }}>経由地（一方通行に沿って自動補間）</label>
              <div style={{ fontSize:9, color:"#38bdf8", marginBottom:8, lineHeight:1.6 }}>
                展開後: {expandRoute(editDef.waypoints).join(" → ") || "（経路なし）"}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:8, minHeight:32 }}>
                {editDef.waypoints.map((sid, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:2,
                                        background:"#0a0f1e", borderRadius:4, padding:"3px 7px", fontSize:11 }}>
                    {i > 0 && <span style={{ color:"#374151", marginRight:2 }}>→</span>}
                    <span style={{ color:SC[stopsMap[sid]?.type||"stop"], fontWeight:700 }}>{sid}</span>
                    <span style={{ color:"#4b5563", fontSize:9, marginLeft:2 }}>{stopsMap[sid]?.name}</span>
                    <button onClick={() => updE("waypoints", editDef.waypoints.filter((_,j)=>j!==i))}
                      style={{ background:"none", border:"none", color:"#ef4444",
                               cursor:"pointer", padding:0, fontSize:13, marginLeft:2 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                {localStopDefs.map(s => (
                  <button key={s.id} onClick={() => updE("waypoints", [...editDef.waypoints, s.id])} style={{
                    padding:"4px 10px", borderRadius:4, border:`1px solid ${SC[s.type]}`,
                    background:"transparent", color:SC[s.type], cursor:"pointer", fontSize:11
                  }}>{s.id} <span style={{ fontSize:9, opacity:0.7 }}>{s.name}</span></button>
                ))}
              </div>
            </div>
          </>)}

          {/* Stop sub-tab */}
          {cfgSub === "stop" && (
            <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#64748b", marginBottom:10 }}>
                地点の名前と種別を変更できます。道路のつながりは固定です。
              </div>
              {localStopDefs.map(s => (
                <div key={s.id} style={{ display:"grid", gridTemplateColumns:"32px 1fr 1fr", gap:8,
                                         alignItems:"center", marginBottom:10 }}>
                  <div style={{ width:28, height:28, borderRadius:"50%", border:`2px solid ${SC[s.type]}`,
                                background:"#0a0f1e", display:"flex", alignItems:"center",
                                justifyContent:"center", fontSize:11, fontWeight:800, color:SC[s.type] }}>{s.id}</div>
                  <input value={s.name}
                    onChange={e => setLocalStopDefs(p => p.map(d => d.id===s.id ? {...d,name:e.target.value} : d))}
                    style={{ padding:"6px 8px", background:"#0a0f1e", border:"1px solid #1f2937",
                             borderRadius:4, color:"#e2e8f0", fontSize:12 }}/>
                  <select value={s.type}
                    onChange={e => setLocalStopDefs(p => p.map(d => d.id===s.id ? {...d,type:e.target.value} : d))}
                    style={{ padding:"6px 8px", background:"#0a0f1e", border:"1px solid #1f2937",
                             borderRadius:4, color:SC[s.type], fontSize:11 }}>
                    {Object.entries(ST).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          <button onClick={save} style={{
            width:"100%", padding:"10px", background:"#38bdf8", color:"#0a0f1e",
            border:"none", borderRadius:6, cursor:"pointer", fontWeight:700, fontSize:13
          }}>💾 保存して適用</button>
        </div>
      )}

      {/* ── Log tab ── */}
      {tab === "log" && (
        <div style={{ flex:1, padding:12, overflow:"auto" }}>
          <div style={{ fontSize:11, color:"#475569", marginBottom:8 }}>移動・イベントログ</div>
          {logs.map((l, i) => (
            <div key={i} style={{ fontSize:11, color:"#94a3b8", padding:"3px 0", borderBottom:"1px solid #1f2937" }}>
              <span style={{ color:"#374151", marginRight:8 }}>{new Date(l.t).toLocaleTimeString()}</span>
              {l.m}
            </div>
          ))}
          {!logs.length && <div style={{ color:"#374151", fontSize:11 }}>まだログなし</div>}
        </div>
      )}

      {/* ── Help tab ── */}
      {tab === "help" && (
        <div style={{ flex:1, padding:16, overflow:"auto", maxWidth:520 }}>
          {[
            { icon:"🗺", title:"マップ", items:[
              "地点（A/B/C/D）はドラッグで自由に移動できます",
              "車両をクリックすると右パネルで選択状態になります",
              "右パネルから停止・稼働の切り替えと経路編集が可能です",
            ]},
            { icon:"🚶", title:"歩行者・障害物", items:[
              "「密度」スライダーで障害物が発生する頻度を調整（0〜100%）",
              "「最大停止時間」スライダーで停止・減速の最大継続時間を設定（〜10秒）",
              "赤リング=停止中 / 黄リング=減速中",
            ]},
            { icon:"🧍", title:"乗客・配車", items:[
              "自動で乗客が発生し（ホテルCが多め）、最近傍の空き車両が自動配車されます",
              "「自動配車」チェックで自動配車ON/OFFを切り替えできます",
              "手動で乗客を発生させたり、選択した車両を指定停留所へ配車できます",
              "紫破線リング=配車中の車両",
            ]},
            { icon:"⚙️", title:"設定 ＞ 車両", items:[
              "「＋」ボタンで車両を追加、「× 削除」で削除できます",
              "経路：地点ボタンを押して経由地を追加、一方通行に沿って自動補間",
              "モード：ループ = 繰り返し走行 / オンデマンド = 終点で長めに停車",
              "カラーパレットからキャラクターカラーを選択、または自由入力も可能",
            ]},
            { icon:"📍", title:"設定 ＞ 地点", items:[
              "各地点の名前と種別（ステーション / ゲート / 停留所 など）を変更できます",
            ]},
            { icon:"💾", title:"保存", items:[
              "「保存して適用」で変更が反映され、localStorageに保存されます",
              "次回アクセス時に設定が自動復元されます",
            ]},
          ].map(({ icon, title, items }) => (
            <div key={title} style={{ background:"#111827", borderRadius:8, padding:12,
                                      marginBottom:10, border:"1px solid #1f2937" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#38bdf8", marginBottom:8 }}>{icon} {title}</div>
              {items.map((item, i) => (
                <div key={i} style={{ fontSize:11, color:"#94a3b8", marginBottom:4,
                                      paddingLeft:8, borderLeft:"2px solid #1f2937" }}>{item}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
