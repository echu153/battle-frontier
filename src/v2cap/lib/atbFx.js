// ============================================================
// 「レベルキャップあり」版（v2cap）— ATB戦闘の見た目の動き（踏み込み・被弾・数字）
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「普通のバトルと同じでプレイヤーが左、モンスターが右に出るように。
//   プレイヤー側はクラスのドット絵が出るように」「モンスター側のドット絵も用意する」「攻撃モーションもドット絵で作ろうと思ってる」
//   ＋選んだこと：モーションは**動きごとのGIF**で渡す（こちらの道具で画面用に変える）・自分の絵は**左右反転して右を向かせる**
// ここは戦闘の記録（core/atb.js の st.log の1件）→ 画面の動き、の読み替えだけ（純関数）。
//   act  … 動いた側が前に踏み込む（あとで攻撃モーションのGIFに差し替える）
//   use  … 補助技・回復・防御を使った側が光る（前には出ない）
//   hit  … 受けた側が揺れて赤く光り、ダメージの数字が出る（crit はクリティカル）
//   miss … 受けた側に「MISS」
//   heal … 回復した側に緑の数字
//   tick … 毒・火傷・出血などで減った側に紫の数字（揺れない）
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

// 動きの長さ（秒）
export const LUNGE_SEC = 0.32
export const HIT_SEC = 0.3
export const POP_SEC = 1.0
export const GLOW_SEC = 0.45

// 踏み込みの量（px）。0→前へ→0 の山
export const lungeOf = (elapsed, px = 22) =>
  (elapsed >= 0 && elapsed < LUNGE_SEC ? Math.sin(Math.PI * elapsed / LUNGE_SEC) * px : 0)
// 被弾の揺れ（px）。だんだん小さく
export const shakeOf = (elapsed, px = 6) =>
  (elapsed >= 0 && elapsed < HIT_SEC ? Math.sin(elapsed * 70) * px * (1 - elapsed / HIT_SEC) : 0)
