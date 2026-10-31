// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の見た目の動き（踏み込み・被弾・数字）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「普通のバトルと同じでプレイヤーが左、モンスターが右に出るように。
//   プレイヤー側はクラスのドット絵が出るように」「モンスター側のドット絵も用意する」「攻撃モーションもドット絵で作ろうと思ってる」
//   ＋選んだこと：モーションは**動きごとのGIF**で渡す（こちらの道具で画面用に変える）・自分の絵はそのままの向き（反転すると逆を向いた）
// ここは戦闘の記録（core/atb.js の st.log の1件）→ 画面の動き、の読み替えだけ（純関数）。
//   act  … 動いた側が前に踏み込む（あとで攻撃モーションのGIFに差し替える）
//   use  … 補助技・回復・防御を使った側が光る（前には出ない）
//   hit  … 受けた側が揺れて赤く光り、ダメージの数字が出る（crit はクリティカル）
//   miss … 受けた側に「MISS」
//   heal … 回復した側に緑の数字
//   tick … 毒・火傷・出血などで減った側に紫の数字（揺れない）
//   技の名前の帯（skillBannerAt）… 敵が技を使ったとき、舞台の上に技の名前を出す（2026-10-30）
// 絵の差し替え（待機・攻撃のGIF）は画面（V2capAtbStage.jsx）の側で行う
// ============================================================

// side＝'a'（自分・左）｜'b'（相手・右）。aName／bName は st.a.name／st.b.name
export const fxEventsOf = (entries, aName, bName) => {
  const sideOf = (name) => (name === aName ? 'a' : name === bName ? 'b' : null)
  const other = (s) => (s === 'a' ? 'b' : 'a')
  const out = []
  for (const l of entries || []) {
    const s = sideOf(l.side)
    if (!s) continue
    if (l.type === 'skill' || l.type === 'normal') {
      const landed = l.type === 'normal' ? !!l.hit : (l.hits ?? 1) > 0
      out.push({ kind: 'act', side: s, skill: l.skill || null })
      if (landed && (l.damage || 0) > 0) out.push({ kind: 'hit', side: other(s), amount: l.damage, crit: !!l.crit })
      else if (!landed) out.push({ kind: 'miss', side: other(s) })
      if (l.drain > 0) out.push({ kind: 'heal', side: s, amount: l.drain })
    } else if (l.type === 'hpBuff') {
      // HPの節目で付いたボスのバフ（2026-10-30）：名前の帯（強い色）＋体が赤く燃える（RAGE_SEC）
      out.push({ kind: 'rage', side: s, skill: l.skill })
    } else if (l.type === 'buff' || l.type === 'guard') {
      out.push({ kind: 'use', side: s, skill: l.skill || null })
    } else if (l.type === 'heal' || l.type === 'regenTick') {
      if (l.type === 'heal') out.push({ kind: 'use', side: s, skill: l.skill || null })
      if ((l.heal || 0) > 0) out.push({ kind: 'heal', side: s, amount: l.heal })
    } else if (l.type === 'ailTick' || l.type === 'hpCost') {
      if ((l.damage || 0) > 0) out.push({ kind: 'tick', side: s, amount: l.damage })
    }
  }
  return out
}

// 起きた時刻を付ける。delay＝{ a: 秒, b: 秒 }：その側にモーション（攻撃の絵）があるとき、
//   殴ったあとの数字・揺れを、絵の「当たる」コマまで遅らせる（lib/motionArt.js の hitMs）
//   秒の代わりに (act) => 秒 も渡せる＝技ごとに絵が違うボス（lib/bossArt.js・act に motion を付けてある・2026-10-28）
//   act の castSkip（ミリ秒・2026-10-30 終焉の黒焔）＝構えのあとは技の途中から流す：t0 をそのぶん前にして、数字と揺れの遅れもそのぶん縮める
export const scheduleFx = (events, t0, delay = {}) => {
  let d = 0
  return events.map(e => {
    if (e.kind === 'act') {
      const dl = delay[e.side], skip = (e.castSkip || 0) / 1000
      d = Math.max(0, ((typeof dl === 'function' ? dl(e) : dl) || 0) - skip)
      return { ...e, t0: t0 - skip }
    }
    if (e.kind === 'use') { d = 0; return { ...e, t0 } }
    return { ...e, t0: t0 + d }
  })
}

// その側に最後のダメージの数字が出る時刻（秒・起きた時刻 t0 つきの fx から。まだ先のものも入れる）。無ければ now
//   ボスの倒れる動きとテロップは、止めの一撃の数字が出てから始める（殴る絵の「当たる」コマまで数字は遅れる）
export const lastHitAtOf = (fx, side, now) => fx.reduce((t, f) => (f.side === side && (f.kind === 'hit' || f.kind === 'tick') && f.t0 > t ? f.t0 : t), now)

// 動きの長さ（秒）
export const LUNGE_SEC = 0.32
export const HIT_SEC = 0.3
export const POP_SEC = 1.0
export const GLOW_SEC = 0.45
export const RAGE_SEC = 1.4   // 節目のバフが付いたとき、体が赤く燃える長さ（絵のエフェクトが届くまでの仮）

// 踏み込みの量（px）。0→前へ→0 の山
export const lungeOf = (elapsed, px = 22) =>
  (elapsed >= 0 && elapsed < LUNGE_SEC ? Math.sin(Math.PI * elapsed / LUNGE_SEC) * px : 0)
// 被弾の揺れ（px）。だんだん小さく
export const shakeOf = (elapsed, px = 6) =>
  (elapsed >= 0 && elapsed < HIT_SEC ? Math.sin(elapsed * 70) * px * (1 - elapsed / HIT_SEC) : 0)

// 【確定】2026-10-30 ユーザー「敵のスキル発動時はスキル名を上に表示させてほしい、FFみたいに」：
//   相手（side）が名前のある技を使った（act に skill がある）とき、舞台の上に技の名前の帯を BANNER_SEC のあいだ出す。
//   通常攻撃（skill が無い）は出さない。はじめの BANNER_IN 秒で出てきて、終わりの BANNER_OUT 秒で消える。続けて技を使ったら新しいほうに替わる
//   → { name, op（濃さ 0〜1）, k（出てきた割合 0〜1・すべり込みに使う）, t0, rage } か null
//   【確定】2026-10-30 HPの節目のバフ（rage・ユーザー「バフは６０％と３０％以下のタイミングで自動発動してほしい、名前も固有」）も同じ帯に出す。
//     rage＝true のときは帯の色を変える（画面）。長さは RAGE_BANNER_SEC（技より少し長く見せる）
export const BANNER_SEC = 1.8
export const RAGE_BANNER_SEC = 2.4
export const BANNER_IN = 0.12
export const BANNER_OUT = 0.3
export const skillBannerAt = (fx, now, side = 'b') => {
  let last = null
  for (const f of fx || []) {
    if ((f.kind === 'act' || f.kind === 'rage') && f.side === side && f.skill && f.t0 <= now && (!last || f.t0 >= last.t0)) last = f
  }
  if (!last) return null
  // 構えのあとに技の途中から流す技（castSkip）は、t0 が前にずれている＝動いた時刻から数える。motion.big＝大技（帯の色は rage と同じ・長さは技のまま）
  const e = now - last.t0 - (last.castSkip || 0) / 1000, rage = last.kind === 'rage', len = rage ? RAGE_BANNER_SEC : BANNER_SEC
  if (e >= len) return null
  const k = Math.min(1, e / BANNER_IN), out = Math.max(0, (e - (len - BANNER_OUT)) / BANNER_OUT)
  return { name: last.skill, op: k * (1 - out), k, t0: last.t0, rage: rage || !!last.motion?.big }
}
