// v2cap の ATB 戦闘の舞台（components/V2capAtbStage.jsx）の組み立てのテスト（node --test）。画面の部品はここでは動かせないので、書き方を見る
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

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
  // v2cap のどの画面でも同じ書き方をしない（2026-10-31 ユーザーの実機で「見えた」＝この2つをやめて直った。どちらが原因かは切り分けていない）
  const dir = new URL('../components/', import.meta.url)
  for (const name of readdirSync(dir).filter(n => n.endsWith('.jsx'))) {
    const src = readFileSync(new URL(name, dir), 'utf8')
    assert.doesNotMatch(src, /height:'100%',[^\n]{0,40}aspectRatio/, `${name}：高さ100%＋縦横比（幅は明示する）`)
    assert.doesNotMatch(src, /zIndex: *-/, `${name}：負の重ね順`)
  }
})

test('【確定】2026-10-31 スマホの軽い表示（ユーザー「30回に落としたって出る、大技の時はそれよりも下がる感じ」）：重いものをやめる・舞台だけを毎回更新する', () => {
  const fightSrc = readFileSync(new URL('../components/V2capAtbFight.jsx', import.meta.url), 'utf8')
  // ぼかしと重ね方は軽い表示で使わない
  assert.match(stage, /const blur = lite \? undefined/)
  assert.match(stage, /filter=\{lite \? undefined : `url\(#\$\{id\}b\)`\}/)
  assert.ok((stage.match(/mixBlendMode: lite \? undefined : 'screen'/g) || []).length >= 3, '重ね方')
  assert.match(stage, /const wrapFilter = lite \? `brightness/, '体の光は明るさだけ')
  assert.match(stage, /brightness\(\$\{bright\.toFixed\(3\)\}\) grayscale/, 'filter はいつも付いている')
  // 背景：マスクをやめて重ね塗り・動くものは数を減らして1秒12回・溶岩は1秒20回
  assert.doesNotMatch(stage.slice(stage.indexOf('function BossBackground')), /maskImage: mask/)
  assert.match(stage, /Math\.floor\(now \* 12\) \/ 12/)
  assert.match(stage, /liteFxOf\(bg\.fx\)/)
  // 部品は別の層・着物の帯と残像はやめる
  assert.match(stage, /willChange: lite && !p\.bend \? 'transform'/)
  assert.match(stage, /art\.flutter && !lite \? flutterBandsAt/)
  assert.match(stage, /!lite && ghosts\.map/)
  // 暗転は背景の層の濃さだけ（舞台ぜんぶを塗り直さない）・舞台の揺れも別の層
  assert.match(stage, /boxShadow: dimOf && !foeArt\?\.bg/)
  assert.match(stage, /willChange: foeBig \? 'transform'/)
  // ゲージは幅を変えない（レイアウトをやり直さない）
  assert.match(stage, /transform:`scaleX\(/)
  // クールダウンの膜：backdrop-filter はやめる
  assert.match(fightSrc, /lite \? \{ background:'rgba\(70, 76, 88, 0\.72\)' \}/)
  // 舞台だけを毎回更新し、ボタンやログは1秒15回
  assert.match(fightSrc, /stageTick\.current\?\.\(\)/)
  assert.match(fightSrc, /now - lastPanel\.current >= PANEL_MS/)
})

test('【確定】2026-10-31 絵が一瞬消えない（ユーザー「たまーにイラストが一瞬なくなることもあるから改善してほしい」）：ポーズの絵が届くまで立ち絵のまま・読んだ絵は手放さない。バフのボタンは絵の上に置かない（ユーザー「バフのところもう少し小さくして、イラストと被ってる、押せればいいから」）', () => {
  assert.match(stage, /const rigOp = show && poseReady \? show\.rig : 1/)
  assert.match(stage, /poseReady && show\?\.poses\.map/)
  const preload = readFileSync(new URL('./artPreload.js', import.meta.url), 'utf8')
  assert.match(preload, /held\.push\(im\)/)
  // バフのボタンは HP の文字の行（絵の枠の外・名前の行は技の名前の帯を押しつぶすので置かない）
  const hpRow = fighter.slice(fighter.indexOf('{/* HP・ゲージ。'), fighter.indexOf('<Bar pct={(Math.max(0, me.hp)'))
  assert.match(hpRow, /<UniqueBuffs side=\{me\}/)
  assert.equal((fighter.match(/<UniqueBuffs /g) || []).length, 1)
  assert.match(stage, /🔥×\{list\.length\}/, '短い札')
})
