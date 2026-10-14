// ============================================================
// バトルフロンティアⅡ「レベルキャップあり」版（v2cap）— 戦闘ログの並び（あるけみすと風）
// ------------------------------------------------------------
// 【確定】2026-10-12 ユーザー指示（あるけみすとの戦闘画面のスクショを見せて）
//   「自分が動くときは自分のアイコンが、敵が動くときは敵のアイコンが表示されるようにして、
//    HPの横にもあるけみすと参考に載せるようにしてほしい」
//   ・ターンの頭に「◯ターン」の見出しと、両方のアイコン＋HPの表（味方は左・敵は右）。
//     決着したら最後に「決着」の表（倒れた側のHPが0）
//   ・行動は「動いた側のアイコン」を左に置いて、その行動の行をまとめる
// 返すもの（上から順）：
//   { kind:'turn', turn, final, me:{ hp, max }, foe:{ hp, max } }  … ターンの頭（final＝決着のとき）の表
//   { kind:'act', who:'me'|'foe', lines:[ログの行…] }               … 行動のまとまり
// 行の文面は今のⅡと同じ（src/v2/lib/battleLog.js の buildBattleLog を1件ずつ通す）。今のⅡの画面は変えない
// ★runBattle の HP の記録（type:'hp'）は「ターンの終わり」に出る。ここでは「次のターンの頭」として使う
//   （1ターン目の頭は満タン。ただし塔の階層守護者は前の防衛で減ったHPから始まる＝start で始まりのHPを渡す・2026-10-14）
// ============================================================
import { buildBattleLog } from '../../v2/lib/battleLog.js'

// 相手の行動を受けた側の行（side＝受けた側）。動いた側のまとまりに入れて、アイコンは切り替えない
//   例：「スライムの攻撃！ 盗賊に50ダメージ」→「盗賊は毒になった！」は、どちらもスライムの行動
export const REACTION_TYPES = new Set([
  'ailment', 'immune', 'debuffImmune', 'debuffGuard', 'wall', 'enCut', 'dodgeCut', 'guts', 'guardHeal',
  'reflect', 'cloneTaken', 'consumeAil', 'dispel', 'ailBurst', 'revive',
  'setFx',   // 防具のセット能力（蜃気楼・番人の守り・天騎士の誓い・攻撃を受けて返す状態異常）＝相手の攻撃への反応
])
// 行動ではなく、時間で起きる行（毒・出血のダメージ、じわじわ回復、溜めた痛みを返す）。
// 直前の行動のまとまりには入れず、いつも別のまとまりにする（同じ側の時間の行が続くときだけ1つに）
export const TICK_TYPES = new Set(['ailTick', 'regenTick', 'mpRegenTick', 'endureRelease'])

// r … runBattle の返り値 ／ you … 自分の名前 ／ foe … 相手の名前
// start … 始まりのHP（{ a, b }・渡さなければ満タン）。塔の守護者は回復しないので、減ったHPから始まる（runBattle の startHp と同じ値を渡す）
export const buildCapBattleView = (r, you, foe, start = {}) => {
  const log = r?.log || []
  const out = []
  const firstHp = log.find(l => l.type === 'hp')
  const table = (turn, l, final = false) => ({
    kind:'turn', turn, final, me:{ hp: l.a, max: l.aMax }, foe:{ hp: l.b, max: l.bMax },
  })
  if (firstHp) out.push(table(1, { a: start.a ?? firstHp.aMax, aMax: firstHp.aMax, b: start.b ?? firstHp.bMax, bMax: firstHp.bMax }))
  let group = null   // いま行を足しているまとまり（表をはさんだら切る）
  log.forEach((l, i) => {
    if (l.type === 'hp') {
      group = null
      const next = log[i + 1]
      if (!next) {
        // 決着（同じHPの表が続くだけなら出さない）
        const last = out[out.length - 1]
        if (!(last?.kind === 'turn' && last.me.hp === l.a && last.foe.hp === l.b)) out.push(table(l.turn, l, true))
      } else if (next.type !== 'hp') {
        out.push(table(l.turn + 1, l))
      }
      // 次も HP の記録＝ターン数の上限で終わった（同じ記録が2件続く）→ 後ろの1件を決着として出す
      return
    }
    const lines = buildBattleLog({ log: [l] }, you, foe)
    if (!lines.length) return
    const who = l.side === you ? 'me' : 'foe'
    const tick = TICK_TYPES.has(l.type)
    if (group && (REACTION_TYPES.has(l.type) || (group.who === who && !!group.tick === tick))) {
      group.lines.push(...lines)
    } else {
      group = { kind:'act', who, lines: [...lines], ...(tick ? { tick: true } : {}) }
      out.push(group)
    }
  })
  return out
}
