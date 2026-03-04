# CLAUDE.md — iino_sim 開発メモ

## プロジェクト概要
iinoモビリティ（小型EVバス）の複数台シミュレーション。React + Vite。コードは基本AIが書く。

**デモ**: https://yoneyoneclub.github.io/iino_sim/

## 開発フロー
- mainに直接コミット・プッシュしてOK（1人開発）
- mainへのpushでGitHub Pagesに自動デプロイ（`.github/workflows/deploy.yml`）

## アーキテクチャ

### ファイル構成
- `src/App.jsx` — すべてのロジック・UIがここに集約（単一ファイル構成）
- `src/main.jsx` — Reactのエントリポイントのみ

### 道路ネットワーク
- 4停留所: A=Info(駅), B=改札, C=ホテル, D=商業
- `DIRECTED_EDGES` で一方通行の有向グラフ
- `shortestPath()` でBFS最短経路探索
- `expandRoute(waypoints)` でwaypoint列を展開してフル経路生成

### 車両

**定義 (`defs` / `VEHICLE_DEFS`)**:
```js
{ id, name, mode: "loop"|"ondemand", waypoints, color, color2, capacity, speed, active }
```
- `defs` はlocalStorageに永続化
- `LS_VER = "v3-charnames"` をbumpすると全データリセット

**ランタイム状態 (`vs`)**:
```js
{ seg, prog, waitT, obstacle, paxCount, customRoute, dispatched, ... }
```

**モード**:
- `loop`: waypoints を繰り返し巡回。各停留所で乗客を乗せる
- `ondemand`: 通常はループ。配車されると pickup → 終点 のカスタムルートに切り替わる

### 乗客
```js
{ id, stopId, status: "waiting"|"boarding"|"done", vid }
```
- ランダム停留所にスポーン（C > B/D > A の重み付け）
- `autoDis=true` のとき最寄りの空き車両に自動配車

### アニメーションループ
- `requestAnimationFrame` で60fps
- **Refを多用**してReactの再レンダリングを回避: `vrRef`, `vsR`, `posR`, `paxR`
- dt（デルタタイム）ベースで速度計算: `adv = speed * 60 * dt / segLen`
- 車両間隔: `occ` マップで同セグメントの先行車との gap を確保

### 障害物（歩行者）
- `pedDensity` スライダーで発生確率を制御
- `"stop"`: 完全停止 / `"slow"`: 35%速度に減速
- `maxStop` スライダーで最大停止時間を設定

### UI
- 左パネル: 車両設定（名前・色・定員・速度・モード・waypoints）
- キャンバス: 停留所はドラッグ可能（位置はlocalStorageに保存）
- 凡例クリックで車両選択・ハイライト
- 車両は2色スプリット表示（SVGの左右で `color` / `color2`）

## よくある作業

### 停留所を追加する
1. `STOPS_INIT` に追加
2. `DIRECTED_EDGES` にエッジを追加
3. `ADJ` は自動再構築される

### 車両を追加する
`VEHICLE_DEFS` に追加。`LS_VER` をbumpして古いlocalStorageをリセット。

### localStorageリセット
`LS_VER` の文字列を変更するとブラウザの保存データが全消去される。

## 注意点
- `defs`（設定）と `vs`（ランタイム）は分離。設定変更時は車両インスタンスが再生成される
- ループ車両の乗客boardingは `status="boarding"` → 完了後 `"done"` に遷移。重複boardingに注意
- 停留所ドラッグはRAFでデバウンス。mouseup時のみlocalStorageに保存
- ログは最大80件保持
