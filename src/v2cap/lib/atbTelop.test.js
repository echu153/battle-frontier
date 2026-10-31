// v2cap の ATB戦闘のテロップ（戦闘開始・討伐完了）と報酬画面の決まりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { START_TELOP_MS, CLEAR_TELOP_MS, FAIL_TELOP_MS, LOSE_DELAY_MS, TIMEUP_DELAY_MS, NO_DEATH_DELAY_MS, startTelopOn, clearTelopDelayOf, endTelopOf } from './atbTelop.js'
import { lastHitAtOf } from './atbFx.js'
import { bossIllustOf } from './bossIllust.js'
import { deathLandMs } from './bossDeath.js'
import { DUNGEON_BOSSES, contributionPctOf } from './dungeon.js'

const read = (f) => readFileSync(new URL(`../components/${f}`, import.meta.url), 'utf8')

test('戦闘開始のテロップのあいだは時計を止める（絵を読んでいるあいだも）', () => {
  assert.equal(startTelopOn(null, 5000), true)
  assert.equal(startTelopOn(1000, 1000), true)
  assert.equal(startTelopOn(1000, 1000 + START_TELOP_MS - 1), true)
  assert.equal(startTelopOn(1000, 1000 + START_TELOP_MS), false)
  // 戦闘の画面は、止まっているあいだ advance を呼ばない
  const src = read('V2capAtbFight.jsx')
  assert.match(src, /if \(s && !s\.over && !startTelopOn\(introT0\.current, now\)\) \{\s+advance\(/)
})

test('討伐完了はボスが倒れて体がほとんど消えたころに出る（どのボスも）', () => {
  for (const key of Object.keys(DUNGEON_BOSSES)) {
    const art = bossIllustOf(key)
    assert.ok(art?.death, `${key} に倒れる動きがある`)
    const at = clearTelopDelayOf(art)
    assert.ok(at > deathLandMs(art.death), `${key} 倒れきってから`)
    assert.ok(at > art.death.burnAt, `${key} 消え始めてから`)
    assert.ok(at < art.death.burnAt + art.death.burnMs, `${key} 消えきる前から`)
  }
  assert.equal(clearTelopDelayOf(null), NO_DEATH_DELAY_MS)   // 図鑑の絵の敵（試し撃ち）
  assert.ok(CLEAR_TELOP_MS > 1000, '読める長さ')
})

test('止めの一撃の時刻：その側の最後のダメージの数字（まだ先のものも入れる）', () => {
  const fx = [
    { side:'b', kind:'hit', t0: 11 },
    { side:'b', kind:'tick', t0: 12.5 },
    { side:'a', kind:'hit', t0: 20 },
    { side:'b', kind:'act', t0: 30 },
  ]
  assert.equal(lastHitAtOf(fx, 'b', 10), 12.5)
  assert.equal(lastHitAtOf(fx, 'b', 13), 13)
  assert.equal(lastHitAtOf([], 'b', 7), 7)
})

test('決着のテロップ（ユーザー「プレイヤーが敗北したときのテロップも欲しい」）：ボスが倒れたら討伐完了・自分が倒れたら敗北・どちらも立っていれば時間切れ', () => {
  const art = bossIllustOf('varuzenoku')
  const fx = [{ side:'b', kind:'hit', t0: 10.2 }, { side:'a', kind:'hit', t0: 10.4 }]
  const clear = endTelopOf({ b: { hp: 0 }, winner:'a' }, fx, 10000, art)
  assert.deepEqual(clear, { kind:'clear', ms: CLEAR_TELOP_MS, at: 10200 + clearTelopDelayOf(art) })
  assert.equal(endTelopOf({ b: { hp: 0 }, winner:'draw' }, fx, 10000, art).kind, 'clear', '相打ちもボスが倒れていれば討伐完了')
  assert.deepEqual(endTelopOf({ b: { hp: 50 }, winner:'b' }, fx, 10000, art), { kind:'lose', ms: FAIL_TELOP_MS, at: 10400 + LOSE_DELAY_MS })
  assert.deepEqual(endTelopOf({ b: { hp: 50 }, winner:'draw' }, [], 10000, art), { kind:'timeup', ms: FAIL_TELOP_MS, at: 10000 + TIMEUP_DELAY_MS })
  const look = read('V2capAtbTelop.jsx')
  for (const w of ['戦闘開始', '討伐完了', '敗北', '時間切れ']) assert.ok(look.includes(`word: '${w}'`), w)
})

test('貢献度：与えたダメージがボスの全体のHPの何割か・1人ぶんは100%まで（ユーザー「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」）', () => {
  assert.equal(contributionPctOf(3250, 6500), 50)
  assert.equal(contributionPctOf(0, 6500), 0)
  assert.equal(contributionPctOf(9000, 6500), 100)
  assert.match(read('V2capBossReward.jsx'), /members\.length > 0 &&/, '1人でも出す')
  assert.match(read('V2capDungeon.jsx'), /貢献度\{contributionPctOf\(m\.damage, run\.hp_max\)\.toFixed\(1\)\}%/, '入っているボスの行にも出す')
})

test('結果の画面：討伐も負けも時間切れもテロップのあと・やめた所でもう倒されていたらすぐ・もう一度挑戦できるのは倒せなかったときだけ', () => {
  const src = read('V2capDungeon.jsx')
  assert.match(src, /onOver=\{onOver\} onEnded=\{onEnded\}/)
  assert.match(src, /if \(fight\.ended \|\| \(!fight\.st\.over && r\?\.ok && r\.run\.cleared\)\) \{/)
  assert.match(src, /const canRetry = r\?\.ok && !r\.run\.cleared && msLeftOf\(r\.run\.ends_at, nowMs\) > 0/)
  // 決着のあとは下のボタンを出さない（テロップのあとの画面で選ぶ）
  assert.match(src, /footer=\{fight\.st\.over \? null/)
  // 報酬画面の「入口へ戻る」は結果が届くまで押せない・画面を切り替えたら上へ
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /<button onClick=\{onBack\} disabled=\{!r\}/)
  assert.match(reward, /text:'敗北'/)
  assert.match(reward, /text:'時間切れ'/)
  assert.match(reward, /ボスの残りHP/)
  assert.match(reward, /もう一度挑戦する（スタミナ\{retryCost\}）/)
  assert.match(reward, /useEffect\(\(\) => \{ window\.scrollTo\(0, 0\) \}, \[\]\)/)
})

test('報酬画面の報酬の欄：EXP は実際に入った量・LVアップの行・SQL を流す前は準備中・渡せるものが無ければ無し', () => {
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /EXP \+\{gainedExpOf\(reward\)\.toLocaleString\(\)\}/)
  assert.match(reward, /Gold \+\{Number\(reward\.gold\)\.toLocaleString\(\)\}/)
  assert.match(reward, /levelUpLines\(cls, reward\.level\)/)
  assert.match(reward, /reward === undefined && .*報酬は準備中です/)
  // ソロの行に倍率を書かない（ユーザー「これ完全ソロ討伐成功！にして、報酬3倍とか具体的な内容は言わないでほしい」）
  assert.match(reward, /reward\.solo && .*>完全ソロ討伐成功！<\/div>/)
  const code = reward.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')   // コメントの外
  assert.doesNotMatch(code, /SOLO_REWARD_MULT|報酬3倍/)
  assert.match(reward, /reward === null && .*この討伐の報酬はありません/)
})

test('その場にいなかった人は入口で受け取る：受け取りのあと同じ報酬画面へ・やめた所でもう倒されていたら報酬画面へ', () => {
  const src = read('V2capDungeon.jsx')
  assert.match(src, /\(state\?\.rewards \|\| \[\]\)\.map\(run =>/)
  assert.match(src, /call\('v2cap_dungeon_claim', \{ p_run: run\.id \}, \(data\) => \{ setClaimed\(data\); onProfile\?\.\(\); load\(\) \}\)/)
  assert.match(src, /if \(claimed\) \{\s+return <V2capBossReward /)
  assert.match(src, /if \(r\?\.ok && r\.run\.cleared\) \{ setFight\(f => \(f \? \{ \.\.\.f, result: r \} : f\)\); if \(r\.reward\) onProfile\?\.\(\); return \}/)
  assert.match(src, /if \(r\?\.reward\) onProfile\?\.\(\)/, 'EXP と Gold が増えたらホームの数字も直す')
})

test('日本語の大きな文字は JP_BOLD の太字（切り抜きのグラデーションにしない）', () => {
  for (const f of ['V2capAtbTelop.jsx', 'V2capBossReward.jsx']) {
    const src = read(f)
    assert.match(src, /fontFamily: JP_BOLD, fontWeight:'bold'/, f)
    assert.ok(!/background-clip|backgroundClip/i.test(src), f)
  }
})
