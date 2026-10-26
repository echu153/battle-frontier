// ============================================================
// バトルフロンティアⅡ（v2cap）— ジェミータ（AI案内役）の画面の側の決まり
// ------------------------------------------------------------
// 【確定】2026-10-26 ユーザー指示「1人1日10回制限」「出撃同様右下にボタンを付けてチャットボットを出す」
//   ＋ユーザー選択「強くなりたい質問には状況を照合してアドバイス」「管理者は無制限」「会話は記録する（管理者だけ読める・30日で消す）」
//   ・聞いた**本人の今の状態だけ**を文にして質問に添える（jemitaStatusText）。**名前・ID・アイコンは入れない**
//     （ユーザー指示「プレイヤーに関する情報も答えないように」＝ほかの人の情報はそもそも渡さない）
//   ・回数・記録・Claude の呼び出しはサーバー（Edge Function v2cap-jemita と supabase_v2cap_jemita.sql）が持つ。ここは表示用
// ============================================================
import { STAT_KEYS, STAT_DEFS } from '../core/stats.js'
import { SLOTS, SLOT_LABEL, RARITY_LABEL, needLvOf } from './equipment.js'
import { equippedItems, statBreakdown, currentSetOf, setsOf } from './loadout.js'
import { jobOf, jobMaxOf, stageLabelOf, nextSkillOf, usableSkillNames, CLASS_BY_ID } from './jobs.js'
import { SKILL_BY_NAME, SKILL_SET_SLOTS, setMpCost, usesCapOf } from './skills.js'
import { apLeftOf } from './ascension.js'
import { openUntilOf } from './sortie.js'
import { spotLabel, recLvText, LAST_SPOT } from './areas.js'
import { plusOf, scrapNameOf } from './smith.js'
import { activeMealOf } from './burger.js'
import { dailyOf, doneCountOf, DAILY_TASKS } from './daily.js'
import { canPray } from '../core/tree.js'
import { GENDER_BY_KEY, genderOf } from './gender.js'
import { TOWER_NAME, floorLabel, clampFloor } from './tower.js'
import { rollStamina, staminaMaxOfProfile, staminaSpanMsOf } from './level.js'
import { setLabel } from './armorSets.js'

// 1人1日の回数（サーバーの v2cap_jemita_limit() と同じ。画面に出すだけ）
export const JEMITA_DAILY_LIMIT = 10
// 1回に送れる字数（サーバーも同じ数で切る）
export const JEMITA_MAX_CHARS = 200
// 続けての会話とみなす長さ（この時間より前の発言は、サーバーが文脈に入れない）
export const JEMITA_THREAD_MS = 30 * 60 * 1000
// 名前（V1 と同じ）
export const JEMITA_NAME = 'AI戦闘民族ジェミータ'
// 開いたときの最初のひとこと（数えない・サーバーへは送らない）
export const JEMITA_HELLO = 'フン、俺に何か用か。このゲームのことなら答えてやる。強くなりたいなら「どうすれば強くなれる？」と訊け。今の貴様を見て答えてやろう。'

const statLabel = (k) => STAT_DEFS[k]?.label || k
const n = (v) => Math.max(0, Math.floor(Number(v) || 0)).toLocaleString()

// 本人の今の状態（Claude へ渡す）。prof＝v2cap_profiles の行・inventory＝v2cap_inventory の行
// ★名前（username）・ID・アイコンは入れない。並びは「強くなる助言」に使う順
export const jemitaStatusText = (prof, inventory, at = new Date()) => {
  if (!prof) return ''
  const lines = []
  const cls = prof.class
  const job = jobOf(prof.jobs, cls)
  const sex = GENDER_BY_KEY[genderOf(prof)]?.label
  lines.push(`LV${prof.lv || 1}・未振りのステータスポイント${n(prof.stat_points)}${sex ? `・性別：${sex}` : ''}`)
  const next = nextSkillOf(cls, job.lv)
  lines.push(`職業：${cls}（${stageLabelOf(cls)}職）CLASS LV${job.lv}/${jobMaxOf(cls)}・アセンションの残りAP${Math.max(0, apLeftOf(prof))}`
    + (next ? `・次に覚える技：${next.skill.name}（CLASS LV${next.jlv}）` : ''))
  const others = Object.entries(prof.jobs || {})
    .filter(([c, j]) => c !== cls && CLASS_BY_ID[c] && (j?.lv || 1) > 1)
    .map(([c, j]) => `${c}${j.lv}`)
  if (others.length) lines.push(`ほかの職業のCLASS LV：${others.join('・')}`)

  const bd = statBreakdown(prof, inventory)
  lines.push(`ステの合計：${STAT_KEYS.map(k => `${statLabel(k)}${n(bd.total[k])}`).join('・')}・戦闘力${n(bd.power)}`)

  const worn = equippedItems(prof, inventory)
  const lv = prof.lv || 1
  const gear = SLOTS.map(slot => {
    const w = worn[slot]
    if (!w) return `${SLOT_LABEL[slot]} なし`
    const plus = plusOf(w.inv)
    const need = needLvOf(w.item, w.inv.ilv)
    const tags = [RARITY_LABEL[w.item.rarity], plus ? `+${plus}` : null, `必要LV${need}`, lv < need ? '要求LV不足' : null].filter(Boolean)
    return `${SLOT_LABEL[slot]} ${w.item.name}（${tags.join('・')}）`
  })
  lines.push(`装備：${gear.join('／')}`)
  const sets = setsOf(prof, inventory)
  if (sets.length) lines.push(`発動中の防具のセット能力：${sets.map(s => `${setLabel(s.area, s.line)} ${s.count}部位`).join('・')}`)

  // スキルセット：枠の数・回数とその上限・消費MPの合計、と、いまの職業で使える（覚えた）技。
  //   【確定】2026-10-26 ユーザー指示「スキルの枠と覚えた技を状態に足して」：本番で試したら、5枠とも埋まっているのに
  //   「影討ちを枠に入れろ」と答えた（枠の数と覚えた技を渡していなかった）
  const set = currentSetOf(prof).filter(e => e?.name)
  const setText = set.length ? set.map(e => `${e.name}×${e.uses || 1}/${usesCapOf(e.name)}`).join(' → ') : 'なし'
  lines.push(`スキルセット（${SKILL_SET_SLOTS}枠中${set.length}枠を使用・上から順・「×回数/回数の上限」）：${setText}`
    + `・消費MP（MP×回数の合計）${setMpCost(set)}/最大MP${n(bd.total.mp)}`)
  const usable = usableSkillNames(cls, prof.learned || [])
  const inSet = new Set(set.map(e => e.name))
  const spare = usable.filter(name => !inSet.has(name))
  lines.push(`いまの職業で使える技（覚えた技）：${usable.length ? usable.map(name => `${name}（MP${SKILL_BY_NAME[name]?.mp ?? '?'}）`).join('・') : 'なし'}`
    + (spare.length ? `／セットに入っていない技：${spare.join('・')}` : '／使える技は全部セットに入っている'))

  const open = openUntilOf(prof.cleared_spots)
  const cleared = (prof.cleared_spots || []).filter(Number.isInteger).length
  lines.push(`進み：いちばん先の開いている場所＝${spotLabel(open)}（${recLvText(open)}）・ボスを倒した場所${cleared}/${LAST_SPOT}`)

  const scraps = Object.entries(prof.materials || {})
    .map(([a, c]) => [Number(a), Math.floor(Number(c) || 0)])
    .filter(([a, c]) => a >= 1 && c > 0)
    .sort((x, y) => x[0] - y[0])
    .map(([a, c]) => `${scrapNameOf(a)}${c}`)
  lines.push(`Gold ${n(prof.gold)}G${scraps.length ? `・残骸：${scraps.join('・')}` : ''}`)

  const max = staminaMaxOfProfile(prof)
  const st = rollStamina(prof.stamina, prof.stamina_at, max, at.getTime(), staminaSpanMsOf(prof))
  lines.push(`スタミナ ${st.n}/${max}`)

  const meal = activeMealOf(prof, at)
  lines.push(`食事：${meal ? `${meal.burger.name}（残り${Math.ceil(meal.leftMs / 60000)}分）` : 'なし'}`)
  const d = dailyOf(prof, at)
  lines.push(`今日のミッション：${d.accepted ? `${doneCountOf(d)}/${DAILY_TASKS.length}${d.claimed ? '・受け取り済み' : ''}` : 'まだ受注していない'}`
    + `・宝樹：${canPray(prof.last_pray_at, at) ? '今日はまだ祈っていない' : '今日は祈った'}`)
  lines.push(`${TOWER_NAME}：${prof.tower_guard ? `${floorLabel(prof.tower_guard)}の守護者` : `次は${floorLabel(clampFloor(prof.tower_floor || 1))}に挑戦`}`)
  return lines.map(l => `- ${l}`).join('\n')
}

// サーバーの返事の reason を画面の文にする
export const jemitaReasonText = (reason) => ({
  daily_limit: `今日の分（${JEMITA_DAILY_LIMIT}回）は使い切った。明日の朝5時にまた来い。`,
  not_configured: 'ジェミータはまだ準備中です（サーバーの設定が済んでいません）。',
  unreachable: 'ジェミータに届きません（サーバーの準備中か、通信が切れています）。',
  no_kb: 'ジェミータはまだ準備中です（ゲームの資料がサーバーに入っていません）。',
  admin_only: 'いまは開発中のため、管理者だけが使えます。',
  unauthorized: 'ログインし直してください。',
  too_long: `長すぎる。${JEMITA_MAX_CHARS}字までにしろ。`,
  empty: '何か書け。',
  busy: '少し待て。前の返事がまだだ。',
  busy_server: 'いまは混み合っています。少し待ってからもう一度試してください（回数は減っていません）。',
  too_long_answer: '考えがまとまらなかった。もう少し短く、具体的に訊け（回数は減っていない）。',
  llm_error: 'いまは返事ができません。少し待ってからもう一度試してください（回数は減っていません）。',
})[reason] || 'いまは返事ができません。時間をおいてもう一度試してください。'
