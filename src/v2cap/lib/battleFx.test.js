// v2cap：戦闘ログのバフ・デバフ・状態異常のアイコンの決まりを固定するテスト（node --test）
// 【確定】2026-10-24 ユーザー指示「戦闘時、バフデバフ、状態異常のアイコンをこのログに見えるようにしたい」
//   「ステータスのバフデバフはどのくらい上昇してるのかもわかるように。例 STR↑〇％ みたいなのをアイコン内に表示させてほしい」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSide, fxOf, runBattle, takeAction } from '../core/battle.js'
import { inflict } from '../core/ailments.js'
import { AIL_KEYS } from '../core/ailments.js'
import { buildCapBattleView } from './battleView.js'
import { fxIconsOf, fxIdOfFile, FX_DEFS } from './battleFx.js'
import { SKILL_BY_NAME, passiveOf } from './skills.js'
import { ICHIJI_BUILDS } from './skillsIchiji.js'
import { attackKindOf } from './jobs.js'

const stats = { hp: 10000, mp: 2000, str: 300, dex: 150, agi: 150, int_stat: 300, vit: 150, luk: 30 }
const fighter = (name, cls, skills = []) => ({
  name, cls, kind: attackKindOf(cls), stats, noClassBonus: true,
  slots: skills.map(n => ({ skill: SKILL_BY_NAME[n], uses: 9 })).filter(s => s.skill),
  passives: passiveOf(cls) ? [passiveOf(cls)] : [],
})
const lcg = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

test('ステの増減は「戦闘の始めからの差」。パッシブのいつもの補正は出さない', () => {
  const sd = createSide(fighter('A', '狂戦士'))
  const start = { ...sd.buffs }
  assert.deepEqual(fxOf(sd, start).st, {})
  sd.buffs.str = (sd.buffs.str || 0) + 25
  sd.buffs.vit = (sd.buffs.vit || 0) - 20
  assert.deepEqual(fxOf(sd, start).st, { str: 25, vit: -20 })
})

test('鈍足のAGI−20%はステの↓には数えない（鈍足のアイコンで出す）。出血はスタック数・ほかは残りターン', () => {
  const sd = createSide(fighter('A', '侍'))
  inflict(sd.ail, 'slow')
  inflict(sd.ail, 'bleed', { stacks: 3 })
  inflict(sd.ail, 'poison')
  const fx = fxOf(sd, { ...sd.buffs })
  assert.deepEqual(fx.st, {})
  assert.deepEqual(fx.ail, { bleed: 3, poison: 4, slow: 4 })
})

test('アイコン：ステは「STR」「↑25%」を重ねる。並びは 上がったステ→そのほかの効果→下がったステ→状態異常', () => {
  const icons = fxIconsOf({ st: { vit: -20, str: 25 }, ail: { poison: 3, bleed: 2 }, buff: { shield: { v: 1234 }, cut: { v: 20, t: 2 }, regen: { t: 3 } } })
  assert.deepEqual(icons.map(x => `${x.kind}:${x.id}`), ['up:str', 'buff:shield', 'buff:cut', 'buff:regen', 'down:vit', 'ail:poison', 'ail:bleed'])
  const [str] = icons
  assert.equal(str.top, 'STR')
  assert.equal(str.bottom, '↑25%')
  const vit = icons.find(x => x.id === 'vit')
  assert.equal(vit.bottom, '↓20%')
  assert.equal(icons.find(x => x.id === 'shield').bottom, '1,234')
  assert.equal(icons.find(x => x.id === 'cut').bottom, '↓20%')
  assert.equal(icons.find(x => x.id === 'regen').corner, '3')
  assert.equal(icons.find(x => x.id === 'poison').corner, '3')
  // 2026-10-24 ユーザー「何のアイコンか全然わかんないからSTRとかと一緒で上に名前いれて」：状態異常・そのほかの効果も上に名前
  assert.equal(icons.find(x => x.id === 'poison').top, '毒')
  assert.equal(icons.find(x => x.id === 'bleed').top, '出血')
  assert.equal(icons.find(x => x.id === 'shield').top, 'バリア')
  assert.equal(icons.find(x => x.id === 'regen').top, 'HP回復')
  assert.ok(icons.every(x => x.top), 'どのアイコンにも名前がある')
  // 2026-10-24 ユーザー「背景あると見ずらいから一旦初期の感じでイラストなし、文字だけにしよう」：絵は出さない
  assert.ok(icons.every(x => x.art === null), '絵は出さない（FX_ART_ON=false）')
  assert.equal(icons.find(x => x.id === 'bleed').corner, '×2')
  assert.equal(icons.find(x => x.id === 'int_stat'), undefined)
  assert.deepEqual(fxIconsOf(null), [])
})

test('INTの表示は「INT」（ゲームの表記）', () => {
  const [x] = fxIconsOf({ st: { int_stat: -10 } })
  assert.equal(x.top, 'INT')
  assert.equal(x.title, 'INT↓10%')
})

test('状態異常はどれもアイコンの一覧にある（足したらここで気づく）', () => {
  for (const k of AIL_KEYS) assert.ok(FX_DEFS.some(d => d.id === k && d.group === 'ail'), `${k}のアイコン`)
})

test('元の絵のファイル名 → アイコン（全角半角・大文字小文字は見ない）', () => {
  assert.equal(fxIdOfFile('STR'), 'str')
  assert.equal(fxIdOfFile('ｉｎｔ'), 'int_stat')
  assert.equal(fxIdOfFile('毒'), 'poison')
  assert.equal(fxIdOfFile('サイレンス'), 'silence')
  assert.equal(fxIdOfFile('バリア'), 'shield')
  assert.equal(fxIdOfFile('なにか'), null)
  // ユーザーが付けた別の名前（2026-10-24）
  assert.equal(fxIdOfFile('ダメージ軽減'), 'cut')
  assert.equal(fxIdOfFile('吸血'), 'drain')
  // ファイル名がかぶっていない
  assert.equal(new Set(FX_DEFS.map(d => d.file)).size, FX_DEFS.length)
})

test('本物の戦闘：ターンの表に両方の効果が入る（1ターン目は始めの効果）。バフの技を使うと上がったステが出る', () => {
  const builds = Object.entries(ICHIJI_BUILDS)
  let ups = 0, ails = 0
  for (const [cls, sets] of builds) {
    const r = runBattle(fighter('A', cls, sets[0]), fighter('B', cls, sets[1]), { rng: lcg(7) })
    const v = buildCapBattleView(r, 'A', 'B')
    const turns = v.filter(x => x.kind === 'turn')
    assert.ok(turns.length >= 2)
    for (const t of turns) for (const s of [t.me, t.foe]) {
      assert.ok(s.fx && s.fx.st && s.fx.ail && s.fx.buff, `${cls}の${t.turn}ターン目の表に効果が入っている`)
      for (const x of fxIconsOf(s.fx)) {
        if (x.kind === 'up') ups++
        if (x.kind === 'ail') ails++
      }
    }
    assert.deepEqual(turns[0].me.fx, r.fx0.aFx)
  }
  assert.ok(ups > 0, '上がったステがどこかで出る')
  assert.ok(ails > 0, '状態異常がどこかで出る')
})

test('fxOf は読むだけ（戦闘の途中で呼んでも side を書き換えない＝戦闘の結果に響かない）', () => {
  const [cls, sets] = Object.entries(ICHIJI_BUILDS)[0]
  const me = createSide(fighter('A', cls, sets[0]))
  const foe = createSide(fighter('B', cls, sets[1]))
  const rng = lcg(5)
  for (let i = 0; i < 6; i++) { takeAction(me, foe, rng, []); takeAction(foe, me, rng, []) }
  const snap = (s) => JSON.stringify(s, (k, v) => (typeof v === 'function' ? undefined : v))
  const before = snap(me)
  fxOf(me, {})
  fxOf(me, { str: 10 })
  assert.equal(snap(me), before)
})
