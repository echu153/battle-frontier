// v2cap の ATB 戦闘の舞台（components/V2capAtbStage.jsx）の組み立てのテスト（node --test）。画面の部品はここでは動かせないので、書き方を見る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const stage = readFileSync(new URL('../components/V2capAtbStage.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fighter = stage.slice(stage.indexOf('function Fighter('), stage.indexOf('// ボスの技のエフェクトが当たる場所'))
const rowsOf = fighter.slice(fighter.lastIndexOf('  return (\n    <>'))

test('【確定】2026-10-31 スマホでもHPバーが両方の列で同じ高さ（ユーザー「スマホ版、なんでHPバーがプレイヤーとモンスターとずれてんの一緒にして」）：舞台は格子・1列は5行・文字が折り返すと MP が上', () => {
  assert.match(stage, /const FIGHTER_ROWS = 5/)
  assert.match(stage, /display:'grid', gridAutoFlow:'column', gridTemplateRows:`repeat\(\$\{FIGHTER_ROWS\}, auto\)`/)
  // 1列の行の数が決まりと同じ（行が増減すると、次の列へはみ出して全部ずれる）
  const rows = rowsOf.split(/\r?\n/).filter(l => /^ {6}<div /.test(l))
  assert.equal(rows.length, 5, '名前・絵・文字・バー・札')
  // どの行も背景より上に重なる（position:relative）・細い列で はみ出さない（minWidth:0）
  for (const r of rows) assert.match(r, /position:'relative', minWidth:0/)
  // HP の文字はバーのすぐ上（折り返すと MP が上の段へ）
  assert.match(rowsOf, /flexWrap:'wrap-reverse', alignContent:'flex-start', alignItems:'flex-start'/)
  assert.ok(rowsOf.indexOf('<span>HP ') < rowsOf.indexOf('<span>MP '), 'HP が先＝折り返すと下の段')
  // HPバーとゲージは同じ行
  const bars = rows.findIndex(r => /<div style=\{\{ position:'relative', minWidth:0 \}\}>/.test(r))
  assert.equal(bars, 3)
})

test('【確定】2026-10-31 端末でプレイヤーとモンスターが消えない（ユーザー「スマホで見てみたらプレイヤーとモンスターが見えない、エフェクトだけ見えてる状態」）：絵の枠は幅を明示・背景は負の重ね順にしない・絵の枠は別の層', () => {
  // aspect-ratio＋height:100% の枠は Safari の flex の中で幅が 0 になることがある
  assert.doesNotMatch(fighter, /height:'100%', aspectRatio/)
  assert.match(fighter, /position:'relative', height:'100%', width:`min\(100%, calc\(\$\{artH\} \* \$\{scale\}\)\)`/)
  assert.match(fighter, /width:'100%', height:`\$\{scale \* 100\}%`, display:'flex', justifyContent:'center'/)
  // 負の z-index を使わない
  assert.doesNotMatch(stage, /zIndex: *-/)
  // 背景は舞台の子のいちばん先
  const body = stage.slice(stage.indexOf('<div ref={stageRef}'))
  assert.ok(body.indexOf('<BossBackground') < body.indexOf('<Fighter '))
  // 絵の枠は別の層（背景の WebGL の層の上に必ず重なる）
  assert.match(fighter, /transform:`translate3d\(\$\{dx\.toFixed\(1\)\}px, 0, 0\)/)
})
