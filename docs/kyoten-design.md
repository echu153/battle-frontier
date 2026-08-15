# 拠点（Basecamp）設計書 v1 — 最小スコープ

作成: 2026-07-28 / 状態: **開発限定（`is_admin`）で実装済み・SQL未適用**

実装物:
- `supabase_kyoten_20260728.sql`（ユーザーが手動適用。単独・冪等・適用順の制約なし）
- `src/pages/Basecamp.jsx` / `src/lib/basecamp.js` / `test/basecamp.test.js`
- ルート `/basecamp`、街メニュー「放置コンテンツ」に `is_admin` 限定ボタン（PC・モバイル両方）

---

## 0. v1のゴール

「**仲間を配置する → 時間が経つ → 資材を回収する → 拠点を強化する**」のループが面白いかだけを検証する。
面白ければ v2 で出撃・釣りからの供給とクラフトを足す。

### v1に入れるもの

- 拠点LV1〜5
- 施設5種（伐採所・採石場・薬草畑・魔力泉・倉庫）
- 資材4種（木材・石材・薬草・魔力の欠片）
- 拠点仲間4種（v1配布ぶん）・所持上限10体
- 作業適性4種（伐採・採掘・採集・水やり）※種族固定・個体差なし
- オフライン蓄積（閉じても進む）・12時間上限
- `is_admin` 限定で先行公開

### v1に入れないもの（v2以降）

出撃の「証」ドロップ／出撃・釣りからの資材供給／クラフト／施設LV／襲撃／拠点訪問／自由建築／仲間の育成・繁殖・空腹。

**この切り分けの最大の利点**: v1は `apply_battle_result` を一切触らない。
つまり「apply_battle_result の最後に流す正」（現在 `supabase_area8_soutenn_20260723.sql` §4）を動かさずに済み、SQL適用順の地雷を踏まない。

---

## 1. 用語

ゲーム内の「**素材**」は既に **お宝素材（無限ポーション用・`materialDrops`）** に使われている。
衝突を避けるため、拠点のものは全て「**資材**」と呼ぶ。UI文言・SQL・変数名すべてで統一する。

---

## 2. データ設計

すべて新規テーブル。**`profiles` に列を追加しない**ため、`protect_profile_stats`（一番事故りやすいトリガー）に手を入れずに済む。
RLSは全テーブル「本人のSELECTのみ」。INSERT/UPDATE/DELETEポリシーは作らず、書込は `SECURITY DEFINER` のRPCのみ（`alchemy_jobs` / `idle_camp` と同じ）。

```sql
-- 拠点本体
CREATE TABLE base_camp (
  player_id  uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lv         int  NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 資材台帳（player_items には入れない＝取引所・袋上限・装備UIに波及させない）
CREATE TABLE base_materials (
  player_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key       text NOT NULL,            -- wood / stone / herb / mana
  qty       int  NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, key)
);

-- 拠点仲間（pets とは完全に別枠。戦闘・ダンジョン・ステボーナスに一切関与しない）
CREATE TABLE base_workers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  species    text NOT NULL,           -- slime / touzoku / yeti / yukionna / ...
  nickname   text,
  facility   text,                    -- 配置先 key。NULL=待機
  slot       int,                     -- 薬草畑のみ 1=採集役 / 2=水やり役。他は 1
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX base_workers_one_per_slot
  ON base_workers(player_id, facility, slot) WHERE facility IS NOT NULL;

-- 施設（未回収ぶんの蓄積をここに持つ）
CREATE TABLE base_facilities (
  player_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key          text NOT NULL,         -- lumber / quarry / herbfield / manaspring / warehouse
  pending      numeric NOT NULL DEFAULT 0,   -- 未回収の資材（小数で保持し、回収時に floor）
  accrued_from timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, key)
);
```

### 蓄積の権威実装（settle方式）

ハートビート（`idle_camp` 方式）は使わない。錬金部屋と同じく **時刻だけで決まる**方式にする。

```
settle(施設) :=
  pending := LEAST(cap, pending + rate_per_hour × (now() - accrued_from) 時間)
  accrued_from := now()
```

`settle` を呼ぶタイミングは **配置変更（変更の前と後）・回収・拠点LVアップ（LVを上げる前）**。
これにより「配置を変えた瞬間に過去ぶんが新レートで再計算される」抜けが構造的に起きない。
`base_get` は書き込まない（`STABLE`）ので、表示値だけ同じ式でその場で計算する。

経過時間はすべてサーバー `now()` 基準。クライアントからの経過時間申告は受け取らない。

### capが下がったときの扱い（自動回収）

仲間を外したり弱い仲間に替えると `rate` が下がり、連動して `cap` も下がる。ここが一番事故る。

| やり方 | 結果 |
|---|---|
| 素直に `LEAST(cap, …)` を代入 | 貯まっていた資材が**消える** |
| `GREATEST(現在値, …)` で守る | `pending > cap` の間ずっと**産出が止まる**（凍結・その間の産出が黙って消える） |
| **採用：超過ぶんをその場で資材へ回収** | 1つも失われず、`pending ≤ cap` が保たれるので産出も止まらない |

`base_settle` は「自動回収した量」を返し、`base_assign` はそれを `collected` として返す。
画面は「🛖 仲間を待機に戻しました　📦 未回収ぶんを回収: 🪵木材 +528」のように必ず伝える
（黙って資材が増えると不審なため）。配置変更の**後**にも settle するのはこの回収を即座に走らせるため。

---

## 3. 数値設計

### 3-1. 資材と施設

| 施設 | key | 産出 | 必要適性 | 枠 | 基礎レート |
|---|---|---|---|---|---|
| 伐採所 | `lumber` | 木材 | 伐採 | 1 | 20 /h |
| 採石場 | `quarry` | 石材 | 採掘 | 1 | 20 /h |
| 薬草畑 | `herbfield` | 薬草 | 採集＋水やり | 2 | 12 /h |
| 魔力泉 | `manaspring` | 魔力の欠片 | 採集 | 1 | 6 /h |
| 倉庫 | `warehouse` | なし | 配置不要 | 0 | 保管上限 +50% |

### 3-2. 適性倍率

| 適性LV | 倍率 |
|---|---|
| なし | 配置不可 |
| 1 | ×1.0 |
| 2 | ×1.5 |
| 3 | ×2.2 |

**産出式**

```
通常施設   : rate = 基礎レート × 適性倍率 × 拠点LVボーナス
薬草畑のみ : rate = 基礎レート × 採集役の適性倍率 × 水やり係数 × 拠点LVボーナス
             水やり係数 = 未配置0.5 / 適性1→1.0 / 適性2→1.2 / 適性3→1.4
```

薬草畑だけ2枠にすることで、「一番強い仲間を並べるだけ」にならず組み合わせを考える遊びが出る。

**保管上限（施設ごと）**

```
cap = rate × 12時間 × (倉庫あり ? 1.5 : 1.0)
```

上限をレート連動にすることで、拠点を強化しても「12時間で満杯」の体験が変わらない。

### 3-3. 拠点LV

| 拠点LV | 配置上限 | 解放施設 | 生産ボーナス | 加入する仲間 |
|---|---|---|---|---|
| 1 | 2体 | 伐採所・採石場 | ×1.0 | スライム（開始時に確定配布） |
| 2 | 3体 | ＋薬草畑 | ×1.0 | 盗賊 |
| 3 | 4体 | ＋魔力泉 | ×1.0 | 雪男 |
| 4 | 5体 | — | ×1.1 | 雪女 |
| 5 | 6体 | ＋倉庫 | ×1.2 | — |

v1では仲間の入手経路が拠点LVアップのみ。
v2で「証」ドロップを足すとき、**溶岩ゴーレム・チャーム系の2種を証専用**にして残しておく（LV配布と競合させない）。

**強化コスト**

| → | 木材 | 石材 | 薬草 | 魔力の欠片 | Gold |
|---|---|---|---|---|---|
| LV2 | 100 | 60 | — | — | 5,000G |
| LV3 | 300 | 200 | — | — | 20,000G |
| LV4 | 800 | 600 | 100 | — | 60,000G |
| LV5 | 2,000 | 1,500 | 300 | 100 | 150,000G |

LV1構成（伐採所＋採石場に適性1を2体）で木材20/h・石材20/h ＝ LV2到達に約5時間。
LV5到達までの想定は実プレイ2〜3日。数値は実装後に調整する前提の初期値。

### 3-4. 拠点仲間（v1配布4種）

画像は `src/constants/pets.js` の既存スプライトをそのまま流用する（新規素材の作成不要）。

| 仲間 | species | 画像 | 伐採 | 採掘 | 採集 | 水やり |
|---|---|---|---|---|---|---|
| スライム | `slime` | `/suraimu.png` | — | — | 2 | 3 |
| 盗賊 | `touzoku` | `/touzoku.png` | 1 | 2 | 2 | — |
| 雪男 | `yeti` | `/yukiotoko.png` | 3 | 1 | — | — |
| 雪女 | `yukionna` | `/yukionna.png` | — | — | 3 | 2 |
| （v2）溶岩ゴーレム | `lavagolem` | `/yougango-remu.png` | 1 | 3 | — | — |
| （v2）マグマスライム | `magmaslime` | `/magumasuraimu.png` | — | 2 | 3 | — |

所持上限10体。v1は上限に当たらないが、v2の証ドロップを見越して最初から実装しておく。

---

## 4. RPC一覧

すべて `SECURITY DEFINER` / `SET search_path = public` / 先頭で `is_admin` 判定（公開時にこの1行を外す）。

| RPC | 引数 | 役割 |
|---|---|---|
| `base_get()` | — | 拠点状態を一括返却。**書き込まない（STABLE）**。LV・資材・施設(pending/cap/rate/unlock_lv)・仲間・次LVコスト・`initialized`・`server_now` |
| `base_init()` | — | 拠点の実体を作る（冪等）。`base_get` が `initialized:false` を返したらクライアントが呼ぶ。スライム1体を配布 |
| `base_assign(p_worker_id, p_facility, p_slot)` | uuid, text, int | 配置／解除。`p_facility = NULL` で待機に戻す。settle先行・配置上限と適性を検証。`collected` を返す |
| `base_collect()` | — | 全施設をsettleして pending を `base_materials` へ加算（floor・端数は施設に残す）。回収量を返す |
| `base_upgrade()` | — | 資材とGoldを消費して拠点LV+1。仲間の加入もここで行う |
| `base_dev_reset()` | — | 開発用の全リセット（is_admin限定・公開後もこの判定は外さない） |

ニックネーム変更（`base_rename_worker`）はv1では作っていない。入れるならペット名と同じNG判定を通すこと。

内部ヘルパ（`base_settle` / `base_rate` / `base_cap` / `base_join_worker` 等）は
`REVOKE ALL … FROM PUBLIC, anon, authenticated` で完全に閉じたうえ、
`p_uid ≠ auth.uid()` なら例外を投げる二重の守りにしてある。

**クライアントはレートを再計算しない。** 表示は全部 `base_get()` の返り値を出すだけにする。
（レイド出現予定でSQLとJSの式がズレた事故と同じ根を最初から作らないため）

---

## 5. 既存システムとの関係

| 対象 | 影響 |
|---|---|
| `apply_battle_result` | **触らない**（v1は出撃ドロップなし） |
| `protect_profile_stats` | **触らない**（`profiles` に列を足さない） |
| 釣り・かかしの排他 | **対象外**。拠点は錬金部屋と同じ「時間が経つだけ」の枠なので、釣り中・修練中も動く |
| ペット（`pets`） | 完全に別テーブル。ステータスボーナス・ダンジョン・戦闘に一切関与しない |
| 取引所 | 資材は `player_items` に入らないため出品対象にならない |
| Gold | `base_upgrade` 内で `profiles.gold` を消費（既存RPCと同じ扱い） |

SQL適用順の制約なし。`supabase_kyoten_20260728.sql` は単独・冪等・いつ流してもよい。

---

## 6. 画面

- ルート: `/basecamp`（街メニューに `kyoten: { label:'🏕 拠点', color:'#8fcf6f', path:'/basecamp' }` を追加。`is_admin` 限定の既存ゲート方式に乗せる）
- レイアウト
  - 上段: 拠点LV・資材4種の所持数・次のLVに必要な量（不足は赤）・「拠点を強化する」ボタン
  - 中段: 施設カード（現在の産出/h・貯まっている量／上限・配置中の仲間）＋「すべて回収」
  - 下段: 仲間一覧（適性をアイコン表示・タップで配置先を選ぶ／解除）
- 街バナー: 「🏕 拠点で資材を回収できます」を錬金部屋と同じ仕組みで出す（v1から入れる。軽い）

---

## 7. テスト方針

- `test/basecamp.test.js`: 産出式・上限・適性の組み合わせをJSの参照実装で検証（表示には使わない・仕様の固定用）
- SQLはローカルPostgresがないため本番適用が初回実行になる。`base_get` は非破壊なので、開発アカウントで `base_get → base_assign → base_collect` を通しで確認する
- 確認する不具合観点
  - 配置変更の直前ぶんが取りこぼされない／二重計上されない
  - 上限到達後に時間が経っても増えない・回収後に正しく再開する
  - 配置上限を超える配置がRPCで弾かれる（クライアント検証だけに頼らない）

---

## 8. v2以降の接続点（v1で作り込みだけしておく）

- **証ドロップ**: `apply_battle_result` の戻り値に同梱（追加RPCを増やさない）。このとき「最後に流す正」が area8 から拠点SQLへ交代するので、ヘッダに引継ぎを明記しMEMORYも更新する
- **釣りの資材**: `fishing_grant_crystal` と同型の `base_grant_material_fishing(p_count)` を追加
- **クラフト**: 強化石は既存経済に直撃するため、入れるなら週上限つきで
- **供給比率の目標**: 拠点放置70% / 出撃20% / 釣り10%
