// バトルフロンティアⅡ 戦闘ログの文面の回帰テスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBattleLog } from './battleLog.js'

const YOU = 'おれおれお'
const FOE = '盗賊'
const build = (log) => buildBattleLog({ log }, YOU, FOE)
const texts = (log) => build(log).filter(l => l.text).map(l => l.text)

test('★どの行にも主語の名前が入る（誰の行動か分かる）', () => {
  // 2026-08-17：自分の行だけ名前が無く「ライト！ 盗賊に756ダメージ！」が
  // 誰の攻撃か分からなかった。全種類について名前が入ることを固定する
  const log = [
    { side: YOU, type:'skill', skill:'ライト', hits:1, damage:756, crit:true },
    { side: FOE, type:'skill', skill:'だましうち', hits:1, damage:179 },
    { side: YOU, type:'normal', hit:true, damage:100 },
    { side: FOE, type:'normal', hit:true, damage:50 },
    { side: YOU, type:'skill', skill:'疾風矢', hits:0 },
    { side: FOE, type:'normal', hit:false },
    { side: YOU, type:'misfire', skill:'マナボルト' },
    { side: YOU, type:'heal', skill:'いやしのて', heal:200 },
    { side: FOE, type:'heal', skill:'きゅうけつ', heal:80 },
    { side: YOU, type:'regenTick', heal:30 },
    { side: YOU, type:'buff', skill:'きあい' },
    { side: FOE, type:'buff', skill:'すばやくなる' },
    { side: YOU, type:'extra' },
    { side: FOE, type:'wall' },
    { side: YOU, type:'debuffGuard' },
    { side: FOE, type:'ailment', ail:'毒' },
    { side: YOU, type:'ailTick', ail:'出血', damage:40, stacks:2 },
    { side: FOE, type:'paralyzed' },
    { side: YOU, type:'reflect', damage:60 },
    { side: FOE, type:'enCut' },
  ]
  const out = texts(log)
  assert.equal(out.length, log.length)
  for (const t of out) {
    assert.ok(t.includes(YOU) || t.includes(FOE), `名前が入っていない行: ${t}`)
  }
})

test('自分と相手で同じ書き方になる（主語が入れ替わるだけ）', () => {
  const mine = texts([{ side: YOU, type:'skill', skill:'ライト', hits:1, damage:756, crit:true }])[0]
  const theirs = texts([{ side: FOE, type:'skill', skill:'だましうち', hits:1, damage:179 }])[0]
  assert.equal(mine, `⚔ ${YOU}の「ライト」！ ${FOE}に756ダメージ！ 💥クリティカル！`)
  assert.equal(theirs, `⚔ ${FOE}の「だましうち」！ ${YOU}に179ダメージ！`)
  // 通常攻撃も同じ形
  assert.equal(texts([{ side: YOU, type:'normal', hit:true, damage:100 }])[0], `${YOU}の攻撃！ ${FOE}に100ダメージ！`)
  assert.equal(texts([{ side: FOE, type:'normal', hit:true, damage:50 }])[0], `${FOE}の攻撃！ ${YOU}に50ダメージ！`)
})

test('外したときも誰が誰にかわされたか分かる', () => {
  assert.equal(texts([{ side: YOU, type:'skill', skill:'疾風矢', hits:0 }])[0],
    `⚔ ${YOU}の「疾風矢」！ しかし${FOE}にかわされた`)
  assert.equal(texts([{ side: FOE, type:'normal', hit:false }])[0],
    `${FOE}の攻撃！ しかし${YOU}にかわされた`)
})

test('吸収は自分のときだけ出す（相手のHP回復は相手の話）', () => {
  assert.match(texts([{ side: YOU, type:'skill', skill:'ドレイン', hits:1, damage:100, drain:30 }])[0], /HPが30回復した/)
  assert.doesNotMatch(texts([{ side: FOE, type:'skill', skill:'ドレイン', hits:1, damage:100, drain:30 }])[0], /回復/)
})

test('HPバーの行はそのまま通す（名前も両方入る）', () => {
  const [row] = build([{ type:'hp', turn:3, a:100, aMax:200, b:50, bMax:300 }])
  assert.equal(row.type, 'hp')
  assert.equal(row.turn, 3)
  assert.equal(row.playerName, YOU)
  assert.equal(row.enemyName, FOE)
  assert.deepEqual([row.playerHp, row.playerMax, row.enemyHp, row.enemyMax], [100, 200, 50, 300])
})

test('数字は3桁ごとに区切る', () => {
  assert.match(texts([{ side: YOU, type:'skill', skill:'大技', hits:1, damage:1234567 }])[0], /1,234,567ダメージ/)
})

test('知らない種類の行は落とす（落ちない）', () => {
  assert.deepEqual(build([{ side: YOU, type:'まだ無い種類' }]), [])
  assert.deepEqual(build(null), [])
  assert.deepEqual(buildBattleLog(null, YOU, FOE), [])
})

// ★2026-08-23 実機で発覚：大防御を撃ってもログに何も出ず「効いていない」ように見えた。
//   戦闘が出すログの種類と、画面が出せる種類がズレたら落とす（片方だけ足すと気付く）。
test('戦闘が出すログの種類は、すべて画面に出せる', () => {
  const emit = new Set()
  for (const p of ['battle.js', 'atb.js']) {
    const src = readFileSync(new URL('./' + p, import.meta.url), 'utf8')
    for (const m of src.matchAll(/type:\s*'([a-zA-Z]+)'/g)) emit.add(m[1])
  }
  const src = readFileSync(new URL('./battleLog.js', import.meta.url), 'utf8')
  const rendered = new Set([...src.matchAll(/l\.type === '([a-zA-Z]+)'/g)].map(m => m[1]))
  const missing = [...emit].filter(t => !rendered.has(t)).sort()
  assert.deepEqual(missing, [], '画面に出せないログの種類: ' + missing.join(', '))
})
