// v2cap の ATB戦闘のテロップ（戦闘開始・討伐完了）と報酬画面の決まりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { START_TELOP_MS, CLEAR_TELOP_MS, NO_DEATH_DELAY_MS, startTelopOn, clearTelopDelayOf } from './atbTelop.js'
import { lastHitAtOf } from './atbFx.js'
import { bossIllustOf } from './bossIllust.js'
import { deathLandMs } from './bossDeath.js'
import { DUNGEON_BOSSES } from './dungeon.js'

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

test('報酬画面：倒したらテロップのあと・ほかの人が先に倒していたら決着のすぐあと・負けと時間切れは入口へ戻るまま', () => {
  const src = read('V2capDungeon.jsx')
  assert.match(src, /onOver=\{onOver\} onCleared=\{onCleared\}/)
  assert.match(src, /const clearedByOther = !won && r\?\.ok && r\.run\.cleared/)
  assert.match(src, /if \(fight\.ended \|\| clearedByOther\) \{\s+return <V2capBossReward /)
  // 勝ったあとは「入口へ戻る」を報酬画面まで出さない（倒れる動きとテロップを待つ）
  assert.match(src, /footer=\{won \? null : fight\.st\.over/)
  // 報酬画面の「入口へ戻る」は結果が届くまで押せない・画面を切り替えたら上へ
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /<button onClick=\{onBack\} disabled=\{!r\}/)
  assert.match(reward, /useEffect\(\(\) => \{ window\.scrollTo\(0, 0\) \}, \[\]\)/)
})

test('報酬画面の報酬の欄：EXP は実際に入った量・LVアップの行・SQL を流す前は準備中・渡せるものが無ければ無し', () => {
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /EXP \+\{gainedExpOf\(reward\)\.toLocaleString\(\)\}/)
  assert.match(reward, /Gold \+\{Number\(reward\.gold\)\.toLocaleString\(\)\}/)
  assert.match(reward, /levelUpLines\(cls, reward\.level\)/)
  assert.match(reward, /reward === undefined && .*報酬は準備中です/)
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
