import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── localStorage helper ───────────────────────────────────────────────────────
const LS_VER = "v4-cap3"; // bump this to reset all saved data

function loadLS(key, fallback) {
  try {
    if (localStorage.getItem("iino_ver") !== LS_VER) {
      localStorage.clear();
      localStorage.setItem("iino_ver", LS_VER);
    }
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  }
  catch { return fallback; }
}

// ─── Road topology ────────────────────────────────────────────────────────────
const STOPS_INIT = [
  { id:"A", name:"Info",   type:"station" },
  { id:"B", name:"改札",   type:"gate"    },
  { id:"C", name:"ホテル", type:"stop"    },
  { id:"D", name:"商業",   type:"stop"    },
];

const INIT_EDGES = [
  { from:"A", to:"B" }, { from:"B", to:"A" },
  { from:"B", to:"C" }, { from:"C", to:"B" },
  { from:"B", to:"D" }, { from:"D", to:"B" },
  { from:"C", to:"D" }, { from:"D", to:"C" },
];

function adjFromEdges(edges) {
  const adj = {};
  edges.forEach(({ from: f, to: t }) => {
    adj[f] = [...(adj[f] || []), t];
  });
  return adj;
}

function shortestPath(from, to, adj) {
  if (from === to) return [from];
  const queue = [[from]], visited = new Set([from]);
  while (queue.length) {
    const path = queue.shift();
    const cur = path[path.length - 1];
    for (const nb of (adj[cur] || [])) {
      if (visited.has(nb)) continue;
      const next = [...path, nb];
      if (nb === to) return next;
      visited.add(nb);
      queue.push(next);
    }
  }
  return null;
}

function expandRoute(waypoints, adj) {
  if (waypoints.length < 2) return waypoints;
  const full = [waypoints[0]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = shortestPath(waypoints[i], waypoints[i + 1], adj);
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

// ─── Character colors (primary + secondary) ───────────────────────────────────
// 1-5: kiha/subi/teyu/mete/kito
// 6-10: roha/hemi/colu/nere/yako
const CHAR_COLORS  = ["#FFE033","#3377EE","#F0F0F0","#FF8833","#FF5555","#55AAEE","#33CC77","#F0F0F0","#3377EE","#F0F0F0"];
const CHAR_COLORS2 = ["#FFE033","#3377EE","#F0F0F0","#FF8833","#FF5555","#AA55EE","#AA55EE","#9933CC","#FFE033","#33CC77"];
const CHAR_NAMES   = ["kiha","subi","teyu","mete","kito","roha","hemi","colu","nere","yako"];

// ─── Vehicle definitions ──────────────────────────────────────────────────────
const VEHICLE_DEFS = [
  { id:1,  name:"kiha", mode:"loop", waypoints:["A","B","A"], color:"#FFE033", color2:"#FFE033", capacity:3, speed:0.8, active:true },
  { id:2,  name:"subi", mode:"loop", waypoints:["A","B","A"], color:"#3377EE", color2:"#3377EE", capacity:3, speed:0.6, active:true },
  { id:3,  name:"teyu", mode:"loop", waypoints:["A","B","A"], color:"#F0F0F0", color2:"#F0F0F0", capacity:3, speed:0.7, active:true },
  { id:4,  name:"mete", mode:"loop", waypoints:["A","B","A"], color:"#FF8833", color2:"#FF8833", capacity:3, speed:0.9, active:true },
  { id:5,  name:"kito", mode:"loop", waypoints:["A","B","A"], color:"#FF5555", color2:"#FF5555", capacity:3, speed:0.8, active:true },
  { id:6,  name:"roha", mode:"loop", waypoints:["A","D","A"], color:"#55AAEE", color2:"#AA55EE", capacity:3, speed:0.8, active:true },
  { id:7,  name:"hemi", mode:"loop", waypoints:["A","C","A"], color:"#33CC77", color2:"#AA55EE", capacity:3, speed:0.8, active:true },
  { id:8,  name:"colu", mode:"loop", waypoints:["A","B","A"], color:"#F0F0F0", color2:"#9933CC", capacity:3, speed:0.7, active:true },
  { id:9,  name:"nere", mode:"loop", waypoints:["A","B","A"], color:"#3377EE", color2:"#FFE033", capacity:3, speed:0.6, active:true },
  { id:10, name:"yako", mode:"loop", waypoints:["A","B","A"], color:"#F0F0F0", color2:"#33CC77", capacity:3, speed:0.9, active:true },
];

function buildVehicles(defs, adj) {
  return defs.map(d => ({ ...d, route: expandRoute(d.waypoints, adj) }));
}

// Light/dark text detection
function isLight(hex) {
  if (!hex || hex.length < 7) return false;
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
  const fx=sp[fromId].x, fy=sp[fromId].y, tx=sp[toId].x, ty=sp[toId].y;
  const { ox, oy } = laneVec(fromId, toId, sp);
  const x1=fx+ox, y1=fy+oy, x2=tx+ox, y2=ty+oy;
  const dx=tx-fx, dy=ty-fy, len=Math.hypot(dx,dy)||1;
  const ux=dx/len, uy=dy/len;
  const mx=(x1+x2)/2, my=(y1+y2)/2;
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

// ─── Two-tone vehicle circle ──────────────────────────────────────────────────
function VehicleCircle({ px, py, v, selected, isParked, isStopped, isSlowed, isDispatched, paxCount }) {
  const R = 11;
  const c1 = v.color, c2 = v.color2 || v.color;
  const twoTone = c1 !== c2;
  const cap     = v.capacity || 2;

  // Text color: choose based on the lighter side
  const textDark = isLight(c1) || isLight(c2);
  const textCol  = textDark ? "#222" : "#fff";

  return (
    <g>
      {/* Selection glow */}
      {selected && <circle cx={px} cy={py} r={21} fill={c1} fillOpacity={0.15}/>}

      {/* Dispatch ring */}
      {isDispatched && <circle cx={px} cy={py} r={15}
        fill="none" stroke="#a78bfa" strokeWidth={2} strokeDasharray="3 2"/>}

      {/* Obstacle rings */}
      {isStopped && <circle cx={px} cy={py} r={14}
        fill="none" stroke="#ef4444" strokeWidth={1.5} opacity={0.7}/>}
      {isSlowed && <circle cx={px} cy={py} r={14}
        fill="none" stroke="#f59e0b" strokeWidth={1.5} opacity={0.7}/>}

      {/* Vehicle body – split circle for two-tone */}
      {twoTone ? (
        <>
          {/* Left half */}
          <path d={`M ${px} ${py} L ${px} ${py-R} A ${R} ${R} 0 0 0 ${px} ${py+R} Z`}
            fill={c1} opacity={isParked?0.72:1}/>
          {/* Right half */}
          <path d={`M ${px} ${py} L ${px} ${py-R} A ${R} ${R} 0 0 1 ${px} ${py+R} Z`}
            fill={c2} opacity={isParked?0.72:1}/>
          {/* Divider line */}
          <line x1={px} y1={py-R} x2={px} y2={py+R}
            stroke={selected?"#fff":"rgba(0,0,0,0.25)"} strokeWidth={selected?1:0.5}/>
          {/* Border */}
          <circle cx={px} cy={py} r={R}
            fill="none"
            stroke={selected?"#fff":"#0a0f1e"}
            strokeWidth={selected?2.5:1.5}
            opacity={isParked?0.72:1}/>
        </>
      ) : (
        <circle cx={px} cy={py} r={R}
          fill={c1}
          stroke={selected?"#fff":"#0a0f1e"}
          strokeWidth={selected?2.5:1.5}
          opacity={isParked?0.72:1}/>
      )}

      {/* Character name */}
      <text x={px} y={py+1} textAnchor="middle" dominantBaseline="middle"
        fill={textCol} fontSize={5.5} fontWeight="700"
        stroke={textDark?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.4)"} strokeWidth={0.6}
        paintOrder="stroke"
        style={{ userSelect:"none", pointerEvents:"none" }}>{v.name}</text>

      {/* Passenger capacity dots */}
      {cap > 1 && (
        <g>
          {Array.from({length: cap}).map((_, i) => {
            const dotX = px - (cap-1) * 3 + i * 6;
            const dotY = py - R - 3;
            return (
              <circle key={i} cx={dotX} cy={dotY} r={1.8}
                fill={i < paxCount ? "#fbbf24" : "rgba(255,255,255,0.25)"}
                stroke="rgba(0,0,0,0.3)" strokeWidth={0.5}/>
            );
          })}
        </g>
      )}
    </g>
  );
}

// ─── SliderRow (outside App to prevent remount on every render) ───────────────
const SliderRow = ({ label, value, min, max, step, unit, onChange }) => (
  <div style={{ marginBottom:7 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
      <span style={{ color:"#94a3b8", fontSize:10 }}>{label}</span>
      <span style={{ color:"#e2e8f0", fontSize:10 }}>
        {typeof value==="number"&&value%1!==0 ? value.toFixed(1) : value}{unit}
      </span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(+e.target.value)} style={{ width:"100%", accentColor:"#38bdf8" }}/>
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [defs,          setDefs]          = useState(() => loadLS("iino_defs", VEHICLE_DEFS));
  const [edges,         setEdges]         = useState(() => loadLS("iino_edges", INIT_EDGES));
  const adj = useMemo(() => adjFromEdges(edges), [edges]);
  const adjR = useRef(adj); adjR.current = adj;
  const vehicles = useMemo(() => buildVehicles(defs, adj), [defs, adj]);

  const [stopPos,       setStopPos]       = useState(() => loadLS("iino_stopPos", INIT_STOP_POS));
  const [stopDefs,      setStopDefs]      = useState(() => loadLS("iino_stopDefs", STOPS_INIT));
  const stopsMap = useMemo(() => Object.fromEntries(stopDefs.map(s => [s.id, s])), [stopDefs]);

  const [vs,            setVs]            = useState(() => {
    const initDefs  = loadLS("iino_defs", VEHICLE_DEFS);
    const initPos   = loadLS("iino_stopPos", INIT_STOP_POS);
    const initEdges = loadLS("iino_edges", INIT_EDGES);
    return buildVehicles(initDefs, adjFromEdges(initEdges)).map((v, i) => ({
      id: v.id, ri:0, prog:0,
      pos: { x: initPos[v.route[0]]?.x ?? 100, y: initPos[v.route[0]]?.y ?? 100 },
      park: null, wait: i * 1.1,
      obstacleTimer: 0, obstacleType: null,
      customRoute: null, pickupStop: null,
      paxCount: 0,
    }));
  });

  const [sel,           setSel]           = useState(null);
  const [tab,           setTab]           = useState("map");
  const [spd,           setSpd]           = useState(0.5);
  const [logs,          setLogs]          = useState([]);
  const [editId,        setEditId]        = useState(() => loadLS("iino_defs", VEHICLE_DEFS)[0]?.id ?? 1);
  const [localDefs,     setLocalDefs]     = useState(() => loadLS("iino_defs", VEHICLE_DEFS));
  const [localStopDefs, setLocalStopDefs] = useState(() => loadLS("iino_stopDefs", STOPS_INIT));
  const [localEdges,    setLocalEdges]    = useState(() => loadLS("iino_edges", INIT_EDGES));
  const [localStopPos,  setLocalStopPos]  = useState(() => loadLS("iino_stopPos", INIT_STOP_POS));
  const [cfgSub,        setCfgSub]        = useState("vehicle");
  const [newEdgeFrom,   setNewEdgeFrom]   = useState("A");
  const [newEdgeTo,     setNewEdgeTo]     = useState("B");
  const [pedDensity,    setPedDensity]    = useState(0.3);
  const [maxStop,       setMaxStop]       = useState(5);
  const [passengers,    setPassengers]    = useState([]);
  const [autoDis,       setAutoDis]       = useState(true);

  const dragRef   = useRef(null);
  const lt        = useRef(null);
  const vrRef     = useRef(vehicles);    vrRef.current    = vehicles;
  const posR      = useRef(stopPos);     posR.current     = stopPos;
  const stopsMapR = useRef(stopsMap);    stopsMapR.current= stopsMap;
  const vsR       = useRef(vs);          vsR.current      = vs;
  const paxR      = useRef(passengers);  paxR.current     = passengers;
  const spdR      = useRef(spd);         spdR.current     = spd;
  const pedR      = useRef(pedDensity);  pedR.current     = pedDensity;
  const maxStopR  = useRef(maxStop);     maxStopR.current = maxStop;
  const autoDisR  = useRef(autoDis);     autoDisR.current = autoDis;
  const paxTimerR  = useRef(Math.random() * 8 + 6);
  const waitStatsR = useRef({}); // { [stopId]: { sum, count } }

  // ── Animation loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    let raf;
    const tick = ts => {
      if (!lt.current) lt.current = ts;
      const dt = Math.min((ts - lt.current) / 1000, 0.05) * spdR.current;
      lt.current = ts;
      const sp = posR.current;

      // Passenger spawn
      let newPax = null, dispatchVid = null;
      const newLogs = [];

      paxTimerR.current -= dt;
      if (paxTimerR.current <= 0) {
        paxTimerR.current = Math.random() * 10 + 5;
        const stopIds = Object.keys(posR.current);
        if (!stopIds.length) { paxTimerR.current = 5; return; }
        const spawnStop = stopIds[Math.floor(Math.random() * stopIds.length)];
        newPax = { id: paxIdCounter++, stopId: spawnStop, status: "waiting", spawnT: Date.now() };
        newLogs.push(`🧍 ${stopsMapR.current[spawnStop]?.name || spawnStop}に乗客が発生`);

        if (autoDisR.current) {
          let best = null, bestScore = Infinity;
          for (const s of vsR.current) {
            const v = vrRef.current.find(x => x.id === s.id);
            if (!v || !v.active || s.pickupStop) continue;
            if (s.paxCount >= (v.capacity || 2)) continue; // at capacity
            const route = s.customRoute || v.route;
            const nri = Math.min(s.ri + 1, route.length - 1);
            const nextStop = route[nri];
            const pathLen = shortestPath(nextStop, spawnStop, adjR.current)?.length ?? 999;
            // score = (remaining current seg + hops to pickup) / speed → lower is faster
            const score = ((1 - s.prog) + Math.max(0, pathLen - 1)) / (v.speed || 1);
            if (score < bestScore) { bestScore = score; best = s; }
          }
          if (best) {
            dispatchVid = best.id;
            newLogs.push(`🚗 ${vrRef.current.find(x=>x.id===best.id)?.name} → ${stopsMapR.current[spawnStop]?.name || spawnStop}へ出動`);
          }
        }
      }

      // Occupancy
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
        (occ[key] = occ[key] || []).push({ id: v.id, prog: s.prog });
      });

      const pickupEvents = [];
      const claimedCounts = {}; // stopId → passengers claimed this frame (prevents double-boarding)

      const nextVs = prevVs.map(s => {
        const v = vrRef.current.find(x => x.id === s.id);
        if (!v || !v.active) return s;
        let route = s.customRoute || v.route;

        // Apply dispatch
        if (dispatchVid === s.id && newPax) {
          const nriD = s.ri + 1;
          let fullRoute, newProg;
          if (s.prog > 0 && nriD < route.length) {
            // Mid-segment: preserve current segment as fullRoute[0→1] so position doesn't jump
            const curFromStop = route[s.ri];
            const curToStop   = route[nriD];
            const toPickup = shortestPath(curToStop, newPax.stopId, adjR.current) || [curToStop, newPax.stopId];
            const toEnd    = shortestPath(newPax.stopId, v.waypoints[v.waypoints.length-1], adjR.current) || [newPax.stopId];
            fullRoute = [curFromStop, ...toPickup, ...toEnd.slice(1)];
            newProg = s.prog; // no visual jump: lanePos(fullRoute[0], fullRoute[1], newProg) = current pos
          } else {
            const curStop  = route[s.ri];
            const toPickup = shortestPath(curStop, newPax.stopId, adjR.current) || [curStop, newPax.stopId];
            const toEnd    = shortestPath(newPax.stopId, v.waypoints[v.waypoints.length-1], adjR.current) || [newPax.stopId];
            fullRoute = [...toPickup, ...toEnd.slice(1)];
            newProg = 0;
          }
          if (fullRoute.length < 2) {
            // Vehicle already at pickup stop → instant boarding
            pickupEvents.push({ stopId: newPax.stopId, done: false, vid: s.id });
            pickupEvents.push({ stopId: newPax.stopId, done: true,  vid: s.id });
            newLogs.push(`🧍→🚗 ${stopsMapR.current[newPax.stopId]?.name || newPax.stopId}で即時乗車`);
            return { ...s, paxCount: s.paxCount + 1 };
          }
          return { ...s, customRoute: fullRoute, pickupStop: newPax.stopId, ri: 0, prog: newProg };
        }

        if (route.length < 2) return s;

        // Obstacle
        let { obstacleTimer, obstacleType } = s;
        if (obstacleTimer > 0) {
          obstacleTimer = Math.max(0, obstacleTimer - dt);
          if (obstacleTimer === 0) obstacleType = null;
        } else if (Math.random() < pedR.current * 0.01) {
          obstacleTimer = Math.random() * maxStopR.current + 0.5;
          obstacleType  = Math.random() < 0.5 ? "stop" : "slow";
        }
        if (obstacleType === "stop" && obstacleTimer > 0)
          return { ...s, obstacleTimer, obstacleType };

        // Wait at stop
        if (s.wait > 0) {
          const alpha = Math.min(1, dt * 5);
          const tx = s.park ? s.park.x : s.pos.x;
          const ty = s.park ? s.park.y : s.pos.y;
          return { ...s, wait: Math.max(0, s.wait - dt), obstacleTimer, obstacleType,
            pos: { x: s.pos.x+(tx-s.pos.x)*alpha, y: s.pos.y+(ty-s.pos.y)*alpha } };
        }

        const nri = s.ri + 1;
        if (nri >= route.length) {
          if (s.pickupStop) pickupEvents.push({ stopId: s.pickupStop, done: true, vid: s.id });
          if (!s.pickupStop && s.paxCount > 0) pickupEvents.push({ loopDone: true, vid: s.id });
          // park at start of the loop's first segment to avoid teleport on restart
          const loopPark = v.route.length >= 2 ? lanePos(v.route[0], v.route[1], 0, sp) : null;
          const base = { ...s, ri:0, prog:0, park:loopPark, customRoute:null, pickupStop:null, paxCount:0, obstacleTimer, obstacleType };
          if (v.mode === "loop")     return { ...base, wait:0.4 };
          if (v.mode === "ondemand") return { ...base, wait:3 };
          return { ...base, wait:1 };
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
          // Loop vehicle: pick up waiting passengers at this stop (when not on a dispatch mission)
          let loopPickupCount = 0;
          if (!s.pickupStop) {
            const cap = v.capacity || 2;
            const waitingHere = paxR.current.filter(x => x.stopId === toId && x.status === "waiting");
            const alreadyClaimed = claimedCounts[toId] || 0;
            loopPickupCount = Math.min(waitingHere.length - alreadyClaimed, cap - s.paxCount);
            if (loopPickupCount > 0) {
              claimedCounts[toId] = alreadyClaimed + loopPickupCount;
              pickupEvents.push({ stopId: toId, loopPickup: true, count: loopPickupCount, vid: s.id });
            }
          }
          // Arrival logging
          let dispatchPickupCount = 0;
          if (s.pickupStop && toId === s.pickupStop) {
            const cap = v.capacity || 2;
            const waitingHere = paxR.current.filter(x => x.stopId === toId && x.status === "waiting");
            const alreadyClaimed = claimedCounts[toId] || 0;
            dispatchPickupCount = Math.min(waitingHere.length - alreadyClaimed, cap - s.paxCount);
            if (dispatchPickupCount > 0) claimedCounts[toId] = alreadyClaimed + dispatchPickupCount;
            if (dispatchPickupCount <= 0) dispatchPickupCount = 0;
            pickupEvents.push({ stopId: s.pickupStop, done: false, count: dispatchPickupCount, vid: s.id });
            newLogs.push(`🧍→🚗 ${stopsMapR.current[toId]?.name || toId}で${dispatchPickupCount}人乗車`);
          } else if (loopPickupCount > 0) {
            newLogs.push(`🚌 ${v.name} ${stopsMapR.current[toId]?.name ?? toId}で${loopPickupCount}人乗車`);
          } else {
            newLogs.push(`${v.name} → ${stopsMapR.current[toId]?.name ?? toId}`);
          }
          // park at the start of the NEXT segment's lane → vehicle glides there during wait,
          // so when movement resumes it starts at exactly the right lane position (no jump)
          const nextSeg = nri + 1;
          const park = nextSeg < route.length
            ? lanePos(toId, route[nextSeg], 0, sp)
            : lanePos(fromId, toId, 1.0, sp);
          const waitTime = (s.pickupStop && toId === s.pickupStop) ? 2.5 : 0.4;
          const newPaxCount = (s.pickupStop && toId === s.pickupStop)
            ? s.paxCount + dispatchPickupCount
            : s.paxCount + loopPickupCount;
          return { ...s, ri:nri, prog:0, pos:lanePos(fromId,toId,1.0,sp), park, wait:waitTime,
            paxCount:newPaxCount, obstacleTimer, obstacleType };
        }
        return { ...s, prog:np, pos:lanePos(fromId,toId,np,sp), park:null, obstacleTimer, obstacleType };
      });

      pickupEvents.forEach(e => {
        if (!e.loopPickup && e.done) newLogs.push(`✅ 配車完了: ${stopsMapR.current[e.stopId]?.name || e.stopId}`);
      });

      vsR.current = nextVs;
      setVs(nextVs);

      if (newPax || pickupEvents.length) {
        const nextPax = (() => {
          let p = paxR.current.filter(x => x.status !== "done");
          if (newPax) p = [...p, newPax];
          pickupEvents.forEach(e => {
            if (e.loopPickup) {
              let cnt = e.count;
              p = p.map(x => {
                if (x.stopId === e.stopId && x.status === "waiting" && cnt > 0) {
                  cnt--;
                  const ws = waitStatsR.current;
                  if (!ws[x.stopId]) ws[x.stopId] = { sum: 0, count: 0 };
                  ws[x.stopId].sum   += Date.now() - (x.spawnT || Date.now());
                  ws[x.stopId].count += 1;
                  return { ...x, status: "boarding", vid: e.vid };
                }
                return x;
              });
            } else if (e.loopDone) {
              p = p.map(x => x.status === "boarding" && x.vid === e.vid ? { ...x, status: "done" } : x);
            } else if (!e.done) {
              let cnt = e.count || 1;
              p = p.map(x => {
                if (x.stopId===e.stopId && x.status==="waiting" && x.vid==null && cnt > 0) {
                  cnt--;
                  const ws = waitStatsR.current;
                  if (!ws[x.stopId]) ws[x.stopId] = { sum: 0, count: 0 };
                  ws[x.stopId].sum   += Date.now() - (x.spawnT || Date.now());
                  ws[x.stopId].count += 1;
                  return {...x, status:"boarding", vid:e.vid};
                }
                return x;
              });
            } else {
              // Only mark done passengers that belong to THIS vehicle (vid check prevents cross-vehicle errors)
              p = p.map(x => x.stopId===e.stopId && x.status==="boarding" && x.vid===e.vid ? {...x,status:"done"} : x);
            }
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

  // ── Stop drag ────────────────────────────────────────────────────────────────
  const handleStopMouseDown = useCallback((e, id) => {
    e.stopPropagation();
    const svg = e.currentTarget.closest("svg");
    const rect = svg.getBoundingClientRect();
    const sx=720/rect.width, sy=430/rect.height;
    dragRef.current = {
      id,
      ox: (e.clientX-rect.left)*sx - posR.current[id].x,
      oy: (e.clientY-rect.top)*sy  - posR.current[id].y,
    };
  }, []);

  const handleSvgMouseMove = useCallback((e) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx=720/rect.width, sy=430/rect.height;
    dragRef.current.pendingX = Math.max(20, Math.min(700, (e.clientX-rect.left)*sx - dragRef.current.ox));
    dragRef.current.pendingY = Math.max(20, Math.min(410, (e.clientY-rect.top)*sy  - dragRef.current.oy));
    if (!dragRef.current.rafId) {
      dragRef.current.rafId = requestAnimationFrame(() => {
        if (dragRef.current) {
          const { id, pendingX:x, pendingY:y } = dragRef.current;
          setStopPos(prev => ({ ...prev, [id]: { x, y } }));
          dragRef.current.rafId = null;
        }
      });
    }
  }, []);

  const handleSvgMouseUp = useCallback(() => {
    if (dragRef.current) localStorage.setItem("iino_stopPos", JSON.stringify(posR.current));
    dragRef.current = null;
  }, []);

  // ── Config handlers ──────────────────────────────────────────────────────────
  const handleTabChange = t => {
    if (t === "cfg") {
      setLocalDefs(defs); setLocalStopDefs(stopDefs);
      setLocalEdges(edges); setLocalStopPos(stopPos);
      if (sel) setEditId(sel);
    }
    setTab(t);
  };

  const selV    = sel ? vehicles.find(v => v.id === sel) : null;
  const editDef = localDefs.find(d => d.id === editId) || localDefs[0];
  const updE    = (f, val) => setLocalDefs(p => p.map(d => d.id === editId ? { ...d, [f]: val } : d));

  const addVehicle = () => {
    const maxId = Math.max(0, ...localDefs.map(d => d.id));
    const nid = maxId + 1;
    const idx = (nid - 1) % CHAR_NAMES.length;
    setLocalDefs(p => [...p, {
      id:nid, name:CHAR_NAMES[idx], mode:"loop", waypoints:["A","B","A"],
      color:CHAR_COLORS[idx], color2:CHAR_COLORS2[idx], capacity:3, speed:0.8, active:true,
    }]);
    setEditId(nid);
  };

  const removeVehicle = id => {
    setLocalDefs(p => {
      const next = p.filter(d => d.id !== id);
      if (editId === id && next.length) setEditId(next[0].id);
      return next;
    });
  };

  const save = () => {
    const newAdj = adjFromEdges(localEdges);
    const nv = buildVehicles(localDefs, newAdj);
    setDefs(localDefs);
    setStopDefs(localStopDefs);
    setEdges(localEdges);
    setStopPos(localStopPos);
    localStorage.setItem("iino_defs",     JSON.stringify(localDefs));
    localStorage.setItem("iino_stopPos",  JSON.stringify(localStopPos));
    localStorage.setItem("iino_stopDefs", JSON.stringify(localStopDefs));
    localStorage.setItem("iino_edges",    JSON.stringify(localEdges));
    setVs(prev => {
      const byId = Object.fromEntries(prev.map(s => [s.id, s]));
      return nv.map((v, i) => {
        const startPos = v.route.length >= 2
          ? lanePos(v.route[0], v.route[1], 0, localStopPos)
          : { x: localStopPos[v.route[0]]?.x ?? 100, y: localStopPos[v.route[0]]?.y ?? 100 };
        const ex = byId[v.id];
        return ex
          ? { ...ex, ri:0, prog:0, wait:i*0.8, pos:startPos, park:null, customRoute:null, pickupStop:null, paxCount:0 }
          : { id:v.id, ri:0, prog:0, pos:startPos, park:null, wait:i*0.8,
              obstacleTimer:0, obstacleType:null, customRoute:null, pickupStop:null, paxCount:0 };
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
    const nriD = s.ri + 1;
    let fullRoute, newProg;
    if (s.prog > 0 && nriD < route.length) {
      // Mid-segment: keep current segment at [0→1] to avoid position jump
      const curFromStop = route[s.ri];
      const curToStop   = route[nriD];
      const toPickup = shortestPath(curToStop, stopId, adjR.current) || [curToStop, stopId];
      const toEnd    = shortestPath(stopId, v.waypoints[v.waypoints.length-1], adjR.current) || [stopId];
      fullRoute = [curFromStop, ...toPickup, ...toEnd.slice(1)];
      newProg = s.prog;
    } else {
      const curStop  = route[s.ri];
      const toPickup = shortestPath(curStop, stopId, adjR.current) || [curStop, stopId];
      const toEnd    = shortestPath(stopId, v.waypoints[v.waypoints.length-1], adjR.current) || [stopId];
      fullRoute = [...toPickup, ...toEnd.slice(1)];
      newProg = 0;
    }
    setVs(prev => prev.map(x => x.id===vid
      ? { ...x, customRoute: fullRoute, pickupStop: stopId, ri: 0, prog: newProg }
      : x
    ));
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
        if (s.paxCount >= (vd.capacity || 2)) continue;
        const d = Math.hypot(s.pos.x-tPos.x, s.pos.y-tPos.y);
        if (d < bestDist) { bestDist=d; best=s; }
      }
      if (best) dispatchTo(best.id, stopId);
    }
  };

  const beds = edges.reduce((acc, e) => {
    const k1 = `${e.from}-${e.to}`, k2 = `${e.to}-${e.from}`;
    if (!acc.seen.has(k1) && !acc.seen.has(k2)) { acc.seen.add(k1); acc.list.push({ fromId:e.from, toId:e.to }); }
    return acc;
  }, { seen: new Set(), list: [] }).list;
  const waitingPax  = passengers.filter(p => p.status === "waiting");
  const boardingPax = passengers.filter(p => p.status === "boarding");

  return (
    <div style={{ background:"#0a0f1e", height:"100vh", display:"flex", flexDirection:"column",
                  fontFamily:"system-ui,sans-serif", color:"#e2e8f0", overflow:"hidden" }}>

      {/* ── Header ── */}
      <div style={{ background:"#111827", borderBottom:"1px solid #1f2937", padding:"6px 12px",
                    display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#38bdf8" }}>🚗 iino Simulator</span>
        <div style={{ display:"flex", gap:2, marginLeft:"auto" }}>
          {[["map","マップ"],["cfg","設定"],["help","?"]].map(([t,l]) => (
            <button key={t} onClick={() => handleTabChange(t)} style={{
              padding:"4px 10px", borderRadius:4, border:"none", cursor:"pointer", fontSize:11,
              background:tab===t?"#38bdf8":"#1f2937", color:tab===t?"#0a0f1e":"#94a3b8", fontWeight:600
            }}>{l}</button>
          ))}
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
              {edges.map(e => (
                <DirectedLane key={`ln-${e.from}-${e.to}`} fromId={e.from} toId={e.to} sp={stopPos}/>
              ))}

              {/* Waiting passenger icons */}
              {waitingPax.map((p, i) => {
                const sp2 = stopPos[p.stopId];
                if (!sp2) return null;
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
                return (
                  <g key={v.id} style={{ cursor:"pointer" }}
                     onClick={() => setSel(v.id===sel ? null : v.id)}>
                    <VehicleCircle
                      px={s.pos.x} py={s.pos.y} v={v}
                      selected={sel===v.id}
                      isParked={s.wait > 0}
                      isStopped={s.obstacleType==="stop" && s.obstacleTimer>0}
                      isSlowed={s.obstacleType==="slow"  && s.obstacleTimer>0}
                      isDispatched={!!s.pickupStop}
                      paxCount={s.paxCount || 0}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Legend */}
            <div style={{ position:"absolute", top:8, left:8,
                          background:"rgba(17,24,39,0.93)", borderRadius:6,
                          padding:"8px 10px", border:"1px solid #1f2937", fontSize:10 }}>
              <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:6 }}>
                {vehicles.map(v => {
                  const twoTone = v.color !== (v.color2 || v.color);
                  const selHere = sel === v.id;
                  return (
                    <div key={v.id}
                      onClick={() => setSel(v.id===sel ? null : v.id)}
                      style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer",
                               opacity: v.active ? 1 : 0.35 }}>
                      <svg width={16} height={16}>
                        {twoTone ? (
                          <>
                            <path d="M 8 8 L 8 1 A 7 7 0 0 0 8 15 Z" fill={v.color}/>
                            <path d="M 8 8 L 8 1 A 7 7 0 0 1 8 15 Z" fill={v.color2}/>
                            <circle cx={8} cy={8} r={7} fill="none"
                              stroke={selHere?"#fff":"#333"} strokeWidth={selHere?1.5:0.5}/>
                          </>
                        ) : (
                          <circle cx={8} cy={8} r={7} fill={v.color}
                            stroke={selHere?"#fff":(isLight(v.color)?"#555":"none")}
                            strokeWidth={selHere?1.5:0.5}/>
                        )}
                      </svg>
                      <span style={{ color: selHere?"#e2e8f0":"#94a3b8", fontSize:9,
                                     fontWeight: selHere?700:400 }}>{v.name}</span>
                    </div>
                  );
                })}
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
              <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:4 }}>
                <svg width={28} height={8}>
                  {[0,1,2].map(i => <circle key={i} cx={4+i*10} cy={4} r={2.5}
                    fill={i===0?"#fbbf24":"rgba(255,255,255,0.25)"} stroke="rgba(0,0,0,0.3)" strokeWidth={0.5}/>)}
                </svg>
                <span style={{ color:"#94a3b8" }}>乗客数/定員</span>
              </div>
              <div style={{ borderTop:"1px solid #1f2937", paddingTop:4, color:"#475569", fontSize:9 }}>
                ⠿ 地点はドラッグで移動
              </div>
            </div>

            {/* Sliders panel */}
            <div style={{ position:"absolute", bottom:8, left:8,
                          background:"rgba(17,24,39,0.95)", borderRadius:6,
                          padding:"9px 11px", border:"1px solid #1f2937", minWidth:195 }}>
              <div style={{ color:"#38bdf8", fontWeight:700, fontSize:11, marginBottom:7 }}>⚙️ 調整</div>
              <SliderRow label="シミュレーション速度" value={spd} min={0.1} max={2} step={0.1} unit="×"
                onChange={v => { lt.current=null; setSpd(v); spdR.current=v; }}/>
              <SliderRow label="歩行者密度（障害物頻度）" value={pedDensity} min={0} max={1} step={0.05} unit="%"
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
                <div style={{ marginBottom:4 }}>
                  <span style={{ color:"#fbbf24" }}>待機: {waitingPax.length}人</span>
                  {boardingPax.length > 0 && <span style={{ color:"#4ade80", marginLeft:8 }}>乗車中: {boardingPax.length}人</span>}
                </div>
                {/* Per-stop average wait time table */}
                {stopDefs.length > 0 && (
                  <table style={{ borderCollapse:"collapse", width:"100%", fontSize:9 }}>
                    <thead>
                      <tr>
                        <th style={{ color:"#475569", textAlign:"left", paddingBottom:2, fontWeight:500 }}>停留所</th>
                        <th style={{ color:"#475569", textAlign:"right", paddingBottom:2, fontWeight:500 }}>平均待機</th>
                        <th style={{ color:"#475569", textAlign:"right", paddingBottom:2, fontWeight:500, paddingLeft:6 }}>件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stopDefs.map(s => {
                        const st = waitStatsR.current[s.id];
                        const avg = st && st.count > 0 ? (st.sum / st.count / 1000).toFixed(0) : null;
                        return (
                          <tr key={s.id}>
                            <td style={{ color: SC[s.type] || "#94a3b8", paddingRight:4 }}>
                              <span style={{ fontWeight:700 }}>{s.id}</span>
                              <span style={{ color:"#475569", marginLeft:3 }}>{s.name}</span>
                            </td>
                            <td style={{ textAlign:"right", color: avg ? "#e2e8f0" : "#374151" }}>
                              {avg ? `${avg}秒` : "—"}
                            </td>
                            <td style={{ textAlign:"right", color:"#475569", paddingLeft:6 }}>
                              {st?.count ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
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
            {/* ── Floating selected-vehicle card ── */}
            {selV && (() => {
              const selS   = vs.find(x => x.id === selV.id);
              const route  = selS?.customRoute || selV.route;
              const ri     = selS ? Math.min(selS.ri, route.length-1) : 0;
              const cur    = stopsMap[route[ri]]?.name ?? "—";
              const pax    = selS?.paxCount || 0;
              const cap    = selV.capacity || 2;
              const isDis  = !!selS?.pickupStop;
              const isObs  = selS?.obstacleType && selS.obstacleTimer > 0;
              const twoTone = selV.color !== (selV.color2 || selV.color);
              return (
                <div style={{ position:"absolute", top:8, right:8,
                              background:"rgba(17,24,39,0.97)", borderRadius:8,
                              padding:"10px 12px", border:`1px solid ${selV.color}`,
                              minWidth:160, fontSize:10, boxShadow:"0 4px 16px rgba(0,0,0,0.5)" }}>
                  {/* Header: color icon + name + close */}
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                    <svg width={20} height={20}>
                      {twoTone ? (
                        <>
                          <path d="M 10 10 L 10 1 A 9 9 0 0 0 10 19 Z" fill={selV.color}/>
                          <path d="M 10 10 L 10 1 A 9 9 0 0 1 10 19 Z" fill={selV.color2||selV.color}/>
                          <circle cx={10} cy={10} r={9} fill="none" stroke="#555" strokeWidth={0.5}/>
                        </>
                      ) : (
                        <circle cx={10} cy={10} r={9} fill={selV.color}
                          stroke={isLight(selV.color)?"#555":"none"} strokeWidth={0.5}/>
                      )}
                    </svg>
                    <span style={{ fontSize:13, fontWeight:700, color:"#e2e8f0", flex:1 }}>{selV.name}</span>
                    <button onClick={() => setSel(null)} style={{
                      background:"none", border:"none", color:"#475569", cursor:"pointer",
                      fontSize:14, padding:"0 2px", lineHeight:1
                    }}>×</button>
                  </div>

                  {/* Status */}
                  <div style={{ marginBottom:8 }}>
                    <div style={{ color:"#6b7280", marginBottom:3 }}>📍 {cur}</div>
                    <div style={{ color:MC[selV.mode], fontSize:9, marginBottom:3 }}>{ML[selV.mode]}</div>
                    {isDis && <div style={{ color:"#a78bfa", fontSize:9 }}>📡 配車中</div>}
                    {isObs && <div style={{ color:selS.obstacleType==="stop"?"#ef4444":"#f59e0b", fontSize:9 }}>
                      {selS.obstacleType==="stop"?"🛑 停止中":"🟡 減速中"}</div>}
                    {/* Pax dots */}
                    <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:4 }}>
                      <span style={{ color:"#475569", fontSize:9 }}>乗客:</span>
                      {Array.from({length:cap}).map((_,i) => (
                        <div key={i} style={{ width:7, height:7, borderRadius:"50%",
                          background:i<pax?"#fbbf24":"#1f2937", border:"1px solid #374151" }}/>
                      ))}
                      <span style={{ color:"#475569", fontSize:9 }}>{pax}/{cap}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    <div style={{ display:"flex", gap:4 }}>
                      <button onClick={() => toggleActive(selV.id)} style={{
                        flex:1, padding:"5px", borderRadius:4, border:"none", cursor:"pointer", fontSize:10,
                        background:selV.active?"#7f1d1d":"#14532d",
                        color:selV.active?"#fca5a5":"#86efac", fontWeight:600
                      }}>{selV.active?"⏹ 停止":"▶ 稼働"}</button>
                      <button onClick={() => { setEditId(selV.id); setLocalDefs(defs); setTab("cfg"); }} style={{
                        flex:1, padding:"5px", borderRadius:4, border:"none", cursor:"pointer", fontSize:10,
                        background:"#1e3a5f", color:"#93c5fd", fontWeight:600
                      }}>✏️ 設定</button>
                    </div>
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
                </div>
              );
            })()}
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
              <div style={{ marginBottom:10 }}>
                <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:3 }}>
                  定員（最大乗客数）: {editDef.capacity || 3}人
                </label>
                <input type="range" min={1} max={3} step={1} value={editDef.capacity || 3}
                  onChange={e => updE("capacity", +e.target.value)} style={{ width:"100%" }}/>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#475569", marginTop:2 }}>
                  <span>1人</span><span>2人</span><span>3人</span>
                </div>
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"flex-start", justifyContent:"space-between" }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:4 }}>カラー（左 / 右）</label>
                  <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:6 }}>
                    <div>
                      <div style={{ fontSize:9, color:"#475569", marginBottom:3 }}>左色</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:4, maxWidth:120 }}>
                        {CHAR_COLORS.map((c, i) => (
                          <button key={i} onClick={() => updE("color", c)} style={{
                            width:18, height:18, background:c, borderRadius:3, cursor:"pointer",
                            border: editDef.color===c ? "2px solid #fff" : "2px solid transparent",
                            outline: isLight(c) ? "1px solid #555" : "none"
                          }}/>
                        ))}
                      </div>
                      <input type="color" value={editDef.color} onChange={e => updE("color", e.target.value)}
                        style={{ width:36, height:24, padding:2, background:"#0a0f1e",
                                 border:"1px solid #1f2937", borderRadius:3, cursor:"pointer" }}/>
                    </div>
                    <div style={{ fontSize:16, color:"#475569", alignSelf:"center" }}>→</div>
                    <div>
                      <div style={{ fontSize:9, color:"#475569", marginBottom:3 }}>右色</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:4, maxWidth:120 }}>
                        {CHAR_COLORS2.map((c, i) => (
                          <button key={i} onClick={() => updE("color2", c)} style={{
                            width:18, height:18, background:c, borderRadius:3, cursor:"pointer",
                            border: editDef.color2===c ? "2px solid #fff" : "2px solid transparent",
                            outline: isLight(c) ? "1px solid #555" : "none"
                          }}/>
                        ))}
                      </div>
                      <input type="color" value={editDef.color2 || editDef.color}
                        onChange={e => updE("color2", e.target.value)}
                        style={{ width:36, height:24, padding:2, background:"#0a0f1e",
                                 border:"1px solid #1f2937", borderRadius:3, cursor:"pointer" }}/>
                    </div>
                    {/* Preview */}
                    <svg width={28} height={28} style={{ flexShrink:0 }}>
                      {editDef.color !== (editDef.color2 || editDef.color) ? (
                        <>
                          <path d="M 14 14 L 14 3 A 11 11 0 0 0 14 25 Z" fill={editDef.color}/>
                          <path d="M 14 14 L 14 3 A 11 11 0 0 1 14 25 Z" fill={editDef.color2||editDef.color}/>
                          <circle cx={14} cy={14} r={11} fill="none" stroke="#555" strokeWidth={0.5}/>
                        </>
                      ) : (
                        <circle cx={14} cy={14} r={11} fill={editDef.color}
                          stroke={isLight(editDef.color)?"#555":"none"} strokeWidth={0.5}/>
                      )}
                    </svg>
                  </div>
                </div>
                {localDefs.length > 1 && (
                  <button onClick={() => removeVehicle(editDef.id)} style={{
                    padding:"6px 10px", borderRadius:4, border:"1px solid #7f1d1d",
                    background:"transparent", color:"#ef4444", cursor:"pointer", fontSize:11, fontWeight:600
                  }}>× 削除</button>
                )}
              </div>
            </div>

            <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
              <label style={{ fontSize:10, color:"#64748b", display:"block", marginBottom:4 }}>経由地（一方通行に沿って自動補間）</label>
              {(() => {
                const localAdj = adjFromEdges(localEdges);
                const expanded = expandRoute(editDef.waypoints, localAdj);
                const expandedSet = new Set(expanded);
                const unreachable = editDef.waypoints.filter(w => !expandedSet.has(w));
                return (<>
                  <div style={{ fontSize:9, color:"#38bdf8", marginBottom: unreachable.length ? 4 : 8, lineHeight:1.6 }}>
                    展開後: {expanded.join(" → ") || "（経路なし）"}
                  </div>
                  {unreachable.length > 0 && (
                    <div style={{ fontSize:9, color:"#ef4444", marginBottom:8,
                                  background:"rgba(239,68,68,0.1)", padding:"4px 6px", borderRadius:3 }}>
                      ⚠️ 到達不能: {unreachable.join(", ")} — 「地点」タブでエッジを追加してください
                    </div>
                  )}
                </>);
              })()}
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
          {cfgSub === "stop" && (() => {
            const addStop = () => {
              const usedIds = new Set(localStopDefs.map(s => s.id));
              const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
              let newId = null;
              for (const c of letters) { if (!usedIds.has(c)) { newId = c; break; } }
              if (!newId) return;
              setLocalStopDefs(p => [...p, { id:newId, name:newId, type:"stop" }]);
              setLocalStopPos(p => ({ ...p, [newId]: { x:360, y:215 } }));
              setNewEdgeFrom(newId);
            };
            const removeStop = id => {
              setLocalStopDefs(p => p.filter(s => s.id !== id));
              setLocalEdges(p => p.filter(e => e.from !== id && e.to !== id));
              setLocalStopPos(p => { const n = {...p}; delete n[id]; return n; });
            };
            const addEdge = () => {
              if (newEdgeFrom === newEdgeTo) return;
              if (localEdges.some(e => e.from === newEdgeFrom && e.to === newEdgeTo)) return;
              setLocalEdges(p => [...p, { from: newEdgeFrom, to: newEdgeTo }]);
            };
            const removeEdge = (f, t) => setLocalEdges(p => p.filter(e => !(e.from===f && e.to===t)));
            return (<>
              {/* 地点リスト */}
              <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                  <span style={{ fontSize:11, color:"#64748b" }}>地点</span>
                  <button onClick={addStop} style={{
                    padding:"4px 10px", borderRadius:4, border:"1px dashed #374151",
                    background:"transparent", color:"#38bdf8", cursor:"pointer", fontSize:11, fontWeight:700
                  }}>＋ 地点を追加</button>
                </div>
                {localStopDefs.map(s => (
                  <div key={s.id} style={{ display:"grid", gridTemplateColumns:"28px 1fr 1fr auto", gap:6,
                                           alignItems:"center", marginBottom:8 }}>
                    <div style={{ width:26, height:26, borderRadius:"50%", border:`2px solid ${SC[s.type]}`,
                                  background:"#0a0f1e", display:"flex", alignItems:"center",
                                  justifyContent:"center", fontSize:10, fontWeight:800, color:SC[s.type] }}>{s.id}</div>
                    <input value={s.name}
                      onChange={e => setLocalStopDefs(p => p.map(d => d.id===s.id ? {...d,name:e.target.value} : d))}
                      style={{ padding:"5px 7px", background:"#0a0f1e", border:"1px solid #1f2937",
                               borderRadius:4, color:"#e2e8f0", fontSize:11 }}/>
                    <select value={s.type}
                      onChange={e => setLocalStopDefs(p => p.map(d => d.id===s.id ? {...d,type:e.target.value} : d))}
                      style={{ padding:"5px 7px", background:"#0a0f1e", border:"1px solid #1f2937",
                               borderRadius:4, color:SC[s.type], fontSize:10 }}>
                      {Object.entries(ST).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    {!"ABCD".includes(s.id) ? (
                      <button onClick={() => removeStop(s.id)} style={{
                        padding:"4px 6px", borderRadius:3, border:"1px solid #7f1d1d",
                        background:"transparent", color:"#ef4444", cursor:"pointer", fontSize:11
                      }}>×</button>
                    ) : <div/>}
                  </div>
                ))}
              </div>

              {/* エッジ（道路のつながり） */}
              <div style={{ background:"#111827", borderRadius:8, padding:12, marginBottom:10 }}>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:10 }}>道路のつながり（有向）</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:10 }}>
                  {localEdges.map((e, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:2,
                                          background:"#0a0f1e", borderRadius:4, padding:"3px 7px", fontSize:11 }}>
                      <span style={{ color:SC[localStopDefs.find(s=>s.id===e.from)?.type||"stop"], fontWeight:700 }}>{e.from}</span>
                      <span style={{ color:"#374151" }}>→</span>
                      <span style={{ color:SC[localStopDefs.find(s=>s.id===e.to)?.type||"stop"], fontWeight:700 }}>{e.to}</span>
                      <button onClick={() => removeEdge(e.from, e.to)} style={{
                        background:"none", border:"none", color:"#ef4444",
                        cursor:"pointer", padding:0, fontSize:13, marginLeft:2
                      }}>×</button>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <select value={newEdgeFrom} onChange={e => setNewEdgeFrom(e.target.value)} style={{
                    padding:"5px 7px", background:"#0a0f1e", border:"1px solid #1f2937",
                    borderRadius:4, color:"#e2e8f0", fontSize:11
                  }}>
                    {localStopDefs.map(s => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
                  </select>
                  <span style={{ color:"#475569" }}>→</span>
                  <select value={newEdgeTo} onChange={e => setNewEdgeTo(e.target.value)} style={{
                    padding:"5px 7px", background:"#0a0f1e", border:"1px solid #1f2937",
                    borderRadius:4, color:"#e2e8f0", fontSize:11
                  }}>
                    {localStopDefs.map(s => <option key={s.id} value={s.id}>{s.id} {s.name}</option>)}
                  </select>
                  <button onClick={addEdge} style={{
                    padding:"5px 10px", borderRadius:4, border:"none",
                    background:"#0369a1", color:"#e2e8f0", cursor:"pointer", fontSize:11, fontWeight:700
                  }}>追加</button>
                </div>
              </div>
            </>);
          })()}

          <button onClick={save} style={{
            width:"100%", padding:"10px", background:"#38bdf8", color:"#0a0f1e",
            border:"none", borderRadius:6, cursor:"pointer", fontWeight:700, fontSize:13
          }}>💾 保存して適用</button>
        </div>
      )}

      {/* ── Help tab ── */}
      {tab === "help" && (
        <div style={{ flex:1, padding:16, overflow:"auto", maxWidth:520 }}>
          {[
            { icon:"🗺", title:"マップ", items:[
              "地点（A/B/C/D）はドラッグで自由に移動できます",
              "車両をクリックすると右パネルで選択状態になります",
              "右パネルから停止・稼働の切り替えと経路編集・手動配車が可能です",
            ]},
            { icon:"🎨", title:"2色カラー", items:[
              "各キャラクターは左半分・右半分の2色で表示されます",
              "車両上部の小さなドットで定員と現在の乗客数がわかります（黄=乗客）",
            ]},
            { icon:"🚶", title:"歩行者・障害物", items:[
              "「密度」で障害物が発生する頻度を調整（0〜100%）",
              "「最大停止時間」で停止・減速の最大継続時間を設定（〜10秒）",
              "赤リング=停止中 / 黄リング=減速中",
            ]},
            { icon:"🧍", title:"乗客・配車", items:[
              "自動で乗客が発生し（ホテルCが多め）、最近傍の空き車両が自動配車されます",
              "定員に達した車両は自動配車されません",
              "手動で乗客を発生させたり、選択した車両を指定停留所へ配車できます",
              "紫破線リング=配車中",
            ]},
            { icon:"⚙️", title:"設定 ＞ 車両", items:[
              "「定員」スライダーで1台あたりの最大乗客数を1〜3人で設定できます",
              "「＋」ボタンで車両追加、「× 削除」で削除できます",
              "左色・右色でキャラクターの2色を個別設定、プレビューで確認できます",
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
