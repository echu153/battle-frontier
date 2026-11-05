// v2cap の ATB戦闘に持っていく技（スキルセットの「挑戦（ATB）」）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ATB_OFF_MAX, atbOffOf, atbSkillNamesOf, atbUsableOf, saveErrText, validateAtbOff } from './atbSkills.js'
import { atbPlayerOf } from './atbPlayer.js'
import { SKILLS } from './skills.js'
import { macroEntriesOf } from './atbMacro.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const ALL = SKILLS.map(s => s.name)
const prof = (over = {}) => ({ class: '侍', learned: ALL, jobs: { 侍: { lv: 50, exp: 0 } }, ...over })

test('【確定】2026-11-06 数の上限なし：何も外していなければ、使える覚えた技を全部持っていく（前と同じ）', () => {
  const all = atbUsableOf(prof())
  assert.equal(all.length, 17, '侍＝自分の10＋剣士の7')
  assert.deepEqual(atbSkillNamesOf(prof()), all)
  assert.deepEqual(atbSkillNamesOf(prof({ atb_off: {} })), all)
  assert.deepEqual(atbSkillNamesOf(prof({ atb_off: { 侍: 'x' } })), all, '形がおかしければ外さない')
})

test('外した技だけ抜ける・並びは名簿の順のまま・職業ごと・あとで覚えた技は持っていく側', () => {
  const all = atbUsableOf(prof())
  const off = [all[5], all[0], all[0], 3, '名簿に無い技']
  const p = prof({ atb_off: { 侍: off, 剣士: [all[1]] } })
  assert.deepEqual(atbOffOf(p), [all[5], all[0], '名簿に無い技'], '文字だけ・重なりなし')
  assert.deepEqual(atbSkillNamesOf(p), all.filter((_, i) => i !== 0 && i !== 5))
  assert.ok(atbSkillNamesOf(p, '剣士').every(n => n !== all[1]), '剣士で外した技は剣士のときだけ外れる')
  // まだ覚えていない技は外していないので、覚えたら持っていく側に入る
  const fewer = prof({ learned: ALL.filter(n => n !== all[16]), atb_off: { 侍: [all[0]] } })
  assert.ok(!atbSkillNamesOf(fewer).includes(all[16]))
  assert.ok(atbSkillNamesOf({ ...fewer, learned: ALL }).includes(all[16]), '覚えたあとは持っていく')
})

test('戦闘の自分（挑戦・試し撃ち）は持っていく技だけを持つ', () => {
  const all = atbUsableOf(prof())
  const p = prof({ atb_off: { 侍: all.slice(0, 10) } })
  const me = atbPlayerOf(p, [])
  assert.deepEqual(me.slots.map(s => s.skill.name), all.slice(10))
  // マクロに外した技が残っていたら飛ばす
  assert.deepEqual(macroEntriesOf({ steps: [all[0], all[12], '@guard'] }, me.slots), [{ idx: 2 }, { guard: true }])
})

test('保存の前の確かめ（SQL の v2cap_set_atb_off と同じ文言）', () => {
  const usable = ['居合斬', '納刀']
  assert.equal(validateAtbOff([], usable), null)
  assert.equal(validateAtbOff(['納刀'], usable), null)
  assert.equal(validateAtbOff(null, usable), '外す技の形式が不正です')
  assert.equal(validateAtbOff([3], usable), '外す技の形式が不正です')
  assert.equal(validateAtbOff(['ファイア'], usable), 'ファイアはいまのクラスで使える覚えた技ではありません')
  assert.equal(validateAtbOff(Array(ATB_OFF_MAX + 1).fill('納刀'), usable), `外す技は${ATB_OFF_MAX}個までです`)
  assert.equal(saveErrText({ message: 'Could not find the function public.v2cap_set_atb_off(p_names) in the schema cache' }), 'サーバーにまだ保存の仕組みがありません（SQLを流すと保存できます）')
  assert.equal(saveErrText(null, { error: '開発限定です' }), '開発限定です')
})

test('画面：スキルセットに「挑戦（ATB）」があり、持っていく技とマクロを保存する', () => {
  const skills = read('../components/V2capSkills.jsx')
  assert.ok(skills.includes("['atb', '⏱ 挑戦（ATB）']"), 'スキルセットの切り替え')
  assert.ok(skills.includes("lazy(() => import('./V2capSkillsAtb.jsx'))"), '戦闘の計算を読む側は後から読む（ホームを重くしない）')
  const atb = read('../components/V2capSkillsAtb.jsx')
  assert.ok(atb.includes("supabase.rpc('v2cap_set_atb_off'"), '持っていく技を保存する')
  assert.ok(atb.includes("supabase.rpc('v2cap_set_atb_macros'"), 'マクロを保存する')
  assert.ok(atb.includes('usable={brought}'), 'マクロに足せるのは持っていく技だけ')
  assert.ok(atb.includes('validateMacros(macros, usable)'), 'マクロの確かめはサーバーと同じ「使える覚えた技」')
  // 【確定】2026-11-06 ユーザー指示「スキルセット内の説明文言はHELPにまとめて」：説明の文は ❓ HELP の小窓の中だけ
  const help = skills.slice(skills.indexOf('<V2Modal title="❓ HELP"'), skills.indexOf('</V2Modal>'))
  const outside = skills.replace(help, '')
  for (const w of ['その職業でだけ使えます', '上から順に発動し', '不発のターンは通常攻撃', 'スキルはCLASS LVで覚えます', '挑戦（ATB戦闘）で使う技を選びます', 'これから覚える技は']) {
    assert.ok(help.includes(w), `HELP に「${w}」`)
    assert.ok(!outside.includes(w) && !atb.includes(w), `画面には「${w}」を出さない`)
  }
  assert.ok(help.includes('<MacroHelp />') && atb.includes('intro={false}'), 'マクロの説明も HELP へ（スキルセットの欄には出さない）')
  // 戦闘の画面の案内も、試し撃ち（開発用）でなくスキルセットを指す
  assert.ok(read('../components/V2capAtbFight.jsx').includes('マクロはスキルセットの「挑戦（ATB）」で登録できます'))
})
