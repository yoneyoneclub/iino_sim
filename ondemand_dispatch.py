"""
iino On-Demand Dispatch System
===============================
乗客リクエストが発生したとき、最適な車両を自動配車するシステム。
実機（Raspberry Pi等）への実装を想定した設計。

使い方:
    python ondemand_dispatch.py

実機連携:
    - VehicleState.position を GPSや車輪エンコーダから更新
    - dispatch_command() でモビリティコントローラへ指示送信
    - passenger_request() を外部センサ/アプリのコールバックで呼び出す
"""

import math
import time
import random
import threading
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

# ─── 地図・トポロジー定義 ─────────────────────────────────────────────────────

STOPS = {
    "A": {"name": "Info",   "type": "station", "x": 80,  "y": 160},
    "B": {"name": "改札",   "type": "gate",    "x": 340, "y": 160},
    "C": {"name": "ホテル", "type": "stop",    "x": 600, "y": 160},
    "D": {"name": "商業",   "type": "stop",    "x": 470, "y": 310},
}

# 一方通行エッジ（from → to のみ走行可能）
DIRECTED_EDGES = [
    ("A", "B"), ("B", "A"),
    ("B", "C"), ("C", "B"),
    ("B", "D"), ("D", "B"),
    ("C", "D"), ("D", "C"),
]

# 隣接リスト構築
ADJ: dict[str, list[str]] = {}
for frm, to in DIRECTED_EDGES:
    ADJ.setdefault(frm, []).append(to)


# ─── 経路探索 ─────────────────────────────────────────────────────────────────

def shortest_path(start: str, goal: str) -> Optional[list[str]]:
    """BFSによる最短経路探索（一方通行考慮）"""
    if start == goal:
        return [start]
    queue = deque([[start]])
    visited = {start}
    while queue:
        path = queue.popleft()
        cur = path[-1]
        for nb in ADJ.get(cur, []):
            if nb in visited:
                continue
            new_path = path + [nb]
            if nb == goal:
                return new_path
            visited.add(nb)
            queue.append(new_path)
    return None


def path_distance(path: list[str]) -> float:
    """経路の総距離（ユークリッド距離の合計）"""
    total = 0.0
    for i in range(len(path) - 1):
        a, b = STOPS[path[i]], STOPS[path[i+1]]
        total += math.hypot(b["x"] - a["x"], b["y"] - a["y"])
    return total


# ─── データクラス ─────────────────────────────────────────────────────────────

@dataclass
class PassengerRequest:
    request_id: int
    stop_id: str                          # 乗車希望停留所
    destination_id: Optional[str] = None  # 降車希望停留所（任意）
    timestamp: float = field(default_factory=time.time)
    status: str = "waiting"              # waiting / assigned / boarding / done

    def __repr__(self):
        dest = f" → {STOPS[self.destination_id]['name']}" if self.destination_id else ""
        return (f"Req#{self.request_id} [{STOPS[self.stop_id]['name']}{dest}]"
                f" ({self.status})")


@dataclass
class VehicleState:
    vehicle_id: int
    name: str
    current_stop: str                     # 現在いる停留所（またはもっとも近い停留所）
    position: tuple[float, float]         # (x, y) 実座標 or GPS
    status: str = "idle"                  # idle / moving / dispatched / pickup
    assigned_request: Optional[int] = None
    route: list[str] = field(default_factory=list)
    route_index: int = 0
    speed: float = 1.0                    # 相対速度

    def distance_to_stop(self, stop_id: str) -> float:
        sx, sy = STOPS[stop_id]["x"], STOPS[stop_id]["y"]
        return math.hypot(self.position[0] - sx, self.position[1] - sy)

    def __repr__(self):
        return (f"Vehicle[{self.name}] at {STOPS.get(self.current_stop, {}).get('name', '?')}"
                f" status={self.status}")


# ─── ディスパッチャー ─────────────────────────────────────────────────────────

class OnDemandDispatcher:
    """
    オンデマンド配車の中核クラス。

    アルゴリズム:
        1. 乗客リクエスト受付
        2. 利用可能な最近傍車両を選択（距離ベース）
        3. 配車ルートを計算（現在地 → 乗車停留所 → 降車停留所 → ベース）
        4. 車両コントローラへ指示送信
        5. 状態追跡・ログ出力
    """

    def __init__(self):
        self.vehicles: dict[int, VehicleState] = {}
        self.requests: dict[int, PassengerRequest] = {}
        self._request_counter = 0
        self._lock = threading.Lock()
        self.log_callbacks: list = []      # ログ出力先を追加可能

    # ── 車両登録 ──────────────────────────────────────────────────────────────

    def register_vehicle(self, vehicle_id: int, name: str, start_stop: str,
                         speed: float = 1.0):
        pos = (STOPS[start_stop]["x"], STOPS[start_stop]["y"])
        self.vehicles[vehicle_id] = VehicleState(
            vehicle_id=vehicle_id,
            name=name,
            current_stop=start_stop,
            position=pos,
            speed=speed,
        )
        self._log(f"車両登録: {name} ({STOPS[start_stop]['name']})")

    def update_vehicle_position(self, vehicle_id: int, stop_id: str,
                                 position: Optional[tuple[float, float]] = None):
        """
        実機では GPS / エンコーダのコールバックでこのメソッドを呼ぶ。
        """
        with self._lock:
            v = self.vehicles.get(vehicle_id)
            if not v:
                return
            v.current_stop = stop_id
            if position:
                v.position = position
            else:
                v.position = (STOPS[stop_id]["x"], STOPS[stop_id]["y"])

            # 配車中の場合、乗車停留所に到着したか確認
            if v.status == "dispatched" and v.assigned_request is not None:
                req = self.requests.get(v.assigned_request)
                if req and stop_id == req.stop_id:
                    v.status = "pickup"
                    req.status = "boarding"
                    self._log(f"🧍→🚗 {v.name} が {STOPS[stop_id]['name']} で乗客をピックアップ")
                    # 実機向け: ここでドアオープン指示を送る
                    self.dispatch_command(vehicle_id, "door_open")
                    # 降車先が設定されていれば、そこへ向かう
                    if req.destination_id:
                        self._route_to_destination(v, req)

    # ── 乗客リクエスト受付 ────────────────────────────────────────────────────

    def passenger_request(self, stop_id: str,
                          destination_id: Optional[str] = None) -> int:
        """
        乗客リクエストを受け付け、最適車両へ自動配車する。

        Args:
            stop_id:        乗車希望停留所 ID ("A"/"B"/"C"/"D")
            destination_id: 降車希望停留所 ID (任意)

        Returns:
            request_id (int)
        """
        with self._lock:
            self._request_counter += 1
            req = PassengerRequest(
                request_id=self._request_counter,
                stop_id=stop_id,
                destination_id=destination_id,
            )
            self.requests[req.request_id] = req
            self._log(f"📩 リクエスト受付: {req}")

            # 最適車両を選択して配車
            vehicle = self._select_best_vehicle(stop_id)
            if vehicle:
                self._dispatch(vehicle, req)
            else:
                self._log(f"⚠️  利用可能な車両がありません (Req#{req.request_id})")

            return req.request_id

    # ── 車両選択アルゴリズム ──────────────────────────────────────────────────

    def _select_best_vehicle(self, target_stop: str) -> Optional[VehicleState]:
        """
        コスト最小の車両を選択。
        コスト = 現在位置から乗車停留所までの経路距離
        """
        best: Optional[VehicleState] = None
        best_cost = float("inf")

        for v in self.vehicles.values():
            # 配車中・乗降中の車両は除外
            if v.status in ("dispatched", "pickup"):
                continue

            # 現在の停留所から乗車停留所までの最短経路コスト
            path = shortest_path(v.current_stop, target_stop)
            if path is None:
                continue
            cost = path_distance(path)

            if cost < best_cost:
                best_cost = cost
                best = v

        return best

    # ── 配車実行 ─────────────────────────────────────────────────────────────

    def _dispatch(self, vehicle: VehicleState, req: PassengerRequest):
        """車両に配車ルートを設定し、指示を送る"""
        # ルート: 現在地 → 乗車停留所
        route_to_pickup = shortest_path(vehicle.current_stop, req.stop_id)
        if not route_to_pickup:
            self._log(f"❌ ルート計算失敗: {vehicle.name} → {req.stop_id}")
            return

        vehicle.status           = "dispatched"
        vehicle.assigned_request = req.request_id
        vehicle.route            = route_to_pickup
        vehicle.route_index      = 0
        req.status               = "assigned"

        self._log(
            f"🚗 配車決定: {vehicle.name} → {STOPS[req.stop_id]['name']}"
            f" (経路: {' → '.join(STOPS[s]['name'] for s in route_to_pickup)})"
        )

        # ── 実機向け: 車両コントローラへ指示送信 ──
        self.dispatch_command(vehicle.vehicle_id, "navigate", route_to_pickup)

    def _route_to_destination(self, vehicle: VehicleState, req: PassengerRequest):
        """乗車後、降車停留所へ向かう"""
        route = shortest_path(req.stop_id, req.destination_id)
        if not route:
            return
        vehicle.route       = route
        vehicle.route_index = 0
        self._log(
            f"➡️  {vehicle.name}: {STOPS[req.stop_id]['name']}"
            f" → {STOPS[req.destination_id]['name']}"
        )
        self.dispatch_command(vehicle.vehicle_id, "navigate", route)

    def complete_request(self, vehicle_id: int):
        """乗降完了を通知（実機からのコールバック想定）"""
        with self._lock:
            v = self.vehicles.get(vehicle_id)
            if not v or v.assigned_request is None:
                return
            req = self.requests.get(v.assigned_request)
            if req:
                req.status = "done"
                self._log(f"✅ 完了: Req#{req.request_id} / {v.name}")
            v.status           = "idle"
            v.assigned_request = None
            v.route            = []

    # ── 実機用フック（オーバーライドして使う） ───────────────────────────────

    def dispatch_command(self, vehicle_id: int, command: str,
                          payload=None):
        """
        実機連携用メソッド。サブクラスでオーバーライドしてください。

        例（MQTT送信）:
            import paho.mqtt.client as mqtt
            client.publish(f"iino/{vehicle_id}/cmd",
                           json.dumps({"cmd": command, "payload": payload}))

        例（シリアル通信）:
            ser.write(f"{vehicle_id},{command},{payload}\\n".encode())
        """
        route_str = " → ".join(STOPS[s]["name"] for s in payload) if payload else ""
        print(f"  [CMD] vehicle={vehicle_id} cmd={command} {route_str}")

    # ── ログ ─────────────────────────────────────────────────────────────────

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        line = f"[{ts}] {msg}"
        print(line)
        for cb in self.log_callbacks:
            cb(line)

    # ── ステータス表示 ────────────────────────────────────────────────────────

    def status_report(self):
        print("\n" + "─" * 50)
        print("【車両ステータス】")
        for v in self.vehicles.values():
            print(f"  {v}")
        print("【リクエスト】")
        active = [r for r in self.requests.values() if r.status != "done"]
        if active:
            for r in active:
                print(f"  {r}")
        else:
            print("  （なし）")
        print("─" * 50)


# ─── シミュレーション実行 ─────────────────────────────────────────────────────

def run_simulation():
    """
    デモ用シミュレーション。
    実機では:
        - VehicleState の更新を GPS/センサコールバックで行う
        - passenger_request() をUI/センサイベントから呼ぶ
        - dispatch_command() でモビリティコントローラを制御する
    """
    print("=" * 50)
    print("  iino オンデマンド配車シミュレーション")
    print("=" * 50)

    dispatcher = OnDemandDispatcher()

    # 車両を登録（初期位置 = Info停留所）
    for i in range(1, 11):
        start = random.choice(list(STOPS.keys()))
        dispatcher.register_vehicle(
            vehicle_id=i,
            name=f"iino-{i:02d}",
            start_stop=start,
            speed=round(random.uniform(0.6, 1.0), 1),
        )

    print()
    dispatcher.status_report()

    # ── イベントループ ──────────────────────────────────────────────────────
    stops_list = list(STOPS.keys())
    event_count = 0

    try:
        while True:
            time.sleep(random.uniform(2, 5))
            event_count += 1

            # ランダムに乗客リクエスト発生（ホテルCが多め）
            weights = {"A": 1, "B": 2, "C": 5, "D": 2}
            choices = [s for s, w in weights.items() for _ in range(w)]
            pickup_stop = random.choice(choices)

            # 30%の確率で降車希望先も設定
            dest = None
            if random.random() < 0.3:
                possible_dests = [s for s in stops_list if s != pickup_stop]
                dest = random.choice(possible_dests)

            req_id = dispatcher.passenger_request(pickup_stop, dest)

            # 配車受付後、シミュレート: 数秒後に車両が到着
            def simulate_arrival(vid, stop, r_id):
                time.sleep(random.uniform(3, 6))
                dispatcher.update_vehicle_position(vid, stop)
                time.sleep(random.uniform(1, 3))  # 乗降時間
                dispatcher.complete_request(vid)

            req = dispatcher.requests.get(req_id)
            if req:
                assigned_vid = next(
                    (v.vehicle_id for v in dispatcher.vehicles.values()
                     if v.assigned_request == req_id),
                    None
                )
                if assigned_vid is not None:
                    t = threading.Thread(
                        target=simulate_arrival,
                        args=(assigned_vid, pickup_stop, req_id),
                        daemon=True,
                    )
                    t.start()

            # 5回ごとにステータス表示
            if event_count % 5 == 0:
                dispatcher.status_report()

    except KeyboardInterrupt:
        print("\n\nシミュレーション終了")
        dispatcher.status_report()


# ─── 実機連携サンプル（MQTT） ────────────────────────────────────────────────

class MqttDispatcher(OnDemandDispatcher):
    """
    MQTT経由で実機モビリティを制御するサブクラスのサンプル。

    使い方:
        dispatcher = MqttDispatcher(broker="192.168.1.100", port=1883)
        dispatcher.register_vehicle(1, "iino-01", "A")
        dispatcher.passenger_request("C")  # ホテルへ配車
    """

    def __init__(self, broker: str = "localhost", port: int = 1883):
        super().__init__()
        self.broker = broker
        self.port   = port
        # 実際には paho-mqtt をインストールして使用:
        # import paho.mqtt.client as mqtt
        # self.client = mqtt.Client()
        # self.client.connect(broker, port)
        # self.client.loop_start()
        print(f"[MQTT] broker={broker}:{port} (デモモード)")

    def dispatch_command(self, vehicle_id: int, command: str, payload=None):
        import json
        topic   = f"iino/{vehicle_id:02d}/cmd"
        message = json.dumps({"cmd": command, "route": payload or []})
        # 実際の送信:
        # self.client.publish(topic, message)
        print(f"  [MQTT→] {topic}: {message}")


# ─── エントリポイント ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    run_simulation()
