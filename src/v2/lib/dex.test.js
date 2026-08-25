// バトルフロンティアⅡ モンスター図鑑のテスト（node --test）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  UNKNOWN, KILL_TIERS, MATERIAL_FIRST_ADD, tableOf, killAddOf, nextKillTier,
  dexStats, dexProgress, killMapOf, foundSetOf,
} from './dex.js'
import { materialsOfEnemy, MATERIALS } from './material.js'
import { AREAS, allEnemies } from './enemies.js'
import { STAT_KEYS } from './stats.js'

test('まだ倒していないものは ??? で出す', () => {
  assert.equal(UNKNOWN, '???')
})

// ★2026-08-26 ユーザー決定。**固定値**（％ではない）
//   通常・時間帯 … 10体で+1／100体で+3／1000体で+10
//   レア・ボス   … 3体で+1／10体で+3／50体で+10
test('討伐数の段は決めたとおり', () => {
  assert.deepEqual(KILL_TIERS.normal, [{ n:10, add:1 }, { n:100, add:3 }, { n:1000, add:10 }])
  assert.deepEqual(KILL_TIERS.rare, [{ n:3, add:1 }, { n:10, add:3 }, { n:50, add:10 }])
  assert.equal(MATERIAL_FIRST_ADD, 1)
  // レアとボスは同じ表・通常と時間帯も同じ表
  assert.equal(tableOf('rare'), KILL_TIERS.rare)
  assert.equal(tableOf('boss'), KILL_TIERS.rare)
  assert.equal(tableOf('normal'), KILL_TIERS.normal)
  assert.equal(tableOf('timed'), KILL_TIERS.normal)
})

test('段は置き換え（積み上げない）', () => {
  for (const [n, want] of [[0, 0], [9, 0], [10, 1], [99, 1], [100, 3], [999, 3], [1000, 10], [99999, 10]]) {
    assert.equal(killAddOf('normal', n), want, `通常 ${n}体`)
  }
  for (const [n, want] of [[0, 0], [2, 0], [3, 1], [9, 1], [10, 3], [49, 3], [50, 10], [99999, 10]]) {
    assert.equal(killAddOf('rare', n), want, `レア ${n}体`)
  }
  // 100体でも +1+3 の 4 にはならない
  assert.equal(killAddOf('normal', 100), 3)
})

test('次の段まであと何体かを出せる', () => {
  assert.deepEqual(nextKillTier('normal', 0), { n:10, add:1 })
  assert.deepEqual(nextKillTier('normal', 10), { n:100, add:3 })
  assert.equal(nextKillTier('normal', 1000), null)
  assert.deepEqual(nextKillTier('rare', 3), { n:10, add:3 })
})

// ★上がるのは「その敵の素材で上がるステータス」と同じもの
test('討伐数で上がるのは、その敵の素材と同じステータス', () => {
  const zero = Object.fromEntries(STAT_KEYS.map(k => [k, 0]))
  assert.deepEqual(dexStats({}, new Set()), zero, '何もしていなければ全部0')

  // スライムの素材はVIT。10体倒すとVITだけ+1
  assert.deepEqual(materialsOfEnemy('スライム')[0].stats, ['vit'])
  assert.deepEqual(dexStats({ スライム: 10 }, new Set()), { ...zero, vit: 1 })
  assert.deepEqual(dexStats({ スライム: 100 }, new Set()), { ...zero, vit: 3 })
  assert.deepEqual(dexStats({ スライム: 9 }, new Set()), zero, '9体ではまだ上がらない')

  // ボス素材はステータスを2つ持つので、その2つに同じだけ乗る
  const bossStats = materialsOfEnemy('ビッグスライム')[0].stats
  assert.equal(bossStats.length, 2, 'ボス素材は2ステ')
  const b = dexStats({ ビッグスライム: 3 }, new Set())
  for (const k of bossStats) assert.equal(b[k], 1, `ビッグスライム3体で ${k}`)
})

test('レアはボスと同じ表で数える（3体で+1）', () => {
  const rare = AREAS[0].rares[0]
  const st = materialsOfEnemy(rare.name)[0].stats
  const got = dexStats({ [rare.name]: 3 }, new Set())
  for (const k of st) assert.equal(got[k], 1, `${rare.name} 3体で ${k}`)
  // 通常の表なら3体では上がらない＝表を取り違えていないこと
  assert.equal(killAddOf('normal', 3), 0)
})

test('素材は初めて図鑑に載ったときに、そのステータスが1上がる', () => {
  const m = materialsOfEnemy('スライム')
  const one = dexStats({}, new Set([m[0].id]))
  assert.equal(one.vit, 1)
  // 3種そろえれば+3（同じステなので足し合わさる）
  const three = dexStats({}, new Set(m.map(x => x.id)))
  assert.equal(three.vit, 3)
  // 知らないidは無視する（素材を消したときに落ちないこと）
  assert.equal(dexStats({}, new Set(['m:999:999:n'])).vit, 0)
})

test('討伐数と素材のぶんは足し合わさる', () => {
  const m = materialsOfEnemy('スライム')
  const got = dexStats({ スライム: 100 }, new Set(m.map(x => x.id)))
  assert.equal(got.vit, 3 + 3, '討伐数+3 と 素材3種+3')
})

// ★全部集めたときにどれだけになるかを見ておく（インフレの歯止め）
test('全部集めても上がり幅は決めた合計に収まる', () => {
  const kills = Object.fromEntries(allEnemies().map(e => [e.name, 100000]))
  const all = dexStats(kills, new Set(MATERIALS.map(m => m.id)))
  const sum = STAT_KEYS.reduce((t, k) => t + all[k], 0)
  // 敵270体（通常/時間帯180体×10＋レア75体×10＋ボス15体×10×2ステ）＋素材810種ぶん
  assert.equal(sum, 2850 + 855, `合計 ${sum}`)
})

test('図鑑の埋まり具合は「1体でも倒した敵」の数', () => {
  const kills = { スライム: 3, コウモリ: 1 }
  assert.deepEqual(dexProgress(['スライム', 'コウモリ', '毒キノコ', 'ビッグスライム'], kills),
    { done: 2, total: 4, pct: 50 })
  assert.deepEqual(dexProgress([], {}), { done: 0, total: 0, pct: 0 })
  assert.equal(dexProgress(['スライム'], { スライム: 0 }).done, 0)
})

test('サーバーの行を画面が使う形に直す', () => {
  assert.deepEqual(killMapOf([{ enemy:'スライム', n:5 }, { enemy:'コウモリ', n:1 }]),
    { スライム: 5, コウモリ: 1 })
  assert.deepEqual(killMapOf(null), {})
  const set = foundSetOf([{ material_id:'m:1:0:n' }, { material_id:'m:1:0:r' }])
  assert.ok(set.has('m:1:0:n'))
  assert.ok(!set.has('m:1:0:u'))
  assert.equal(foundSetOf(undefined).size, 0)
})

// ★画面が「倒すまで名前を出さない」ことを縛る。ここが緩むと図鑑の意味が消える
test('★図鑑の画面は、倒していない敵の名前も素材の名前も出さない', () => {
  const src = readFileSync(new URL('../components/V2Dex.jsx', import.meta.url), 'utf8')
  assert.match(src, /seen \? e\.name : UNKNOWN/, '敵の名前を出しっぱなしにしている')
  assert.match(src, /got \? m\.name : UNKNOWN/, '素材の名前を出しっぱなしにしている')
  // しぼり込みでも漏らさない（未討伐の敵が検索で出てこないこと）
  assert.match(src, /if \(!\(kills\[e\.name\] > 0\)\) return false/, 'しぼり込みから未討伐が漏れる')
  // ★JSXに ** を書くとそのまま画面に出てしまう（Markdownではない）。実際にやらかした
  //   コメント行（// で始まる）は画面に出ないので見ない
  const jsx = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  assert.ok(!/\*\*/.test(jsx), 'JSXにアスタリスクの強調が残っている')
})

// ★プロフィールの画面まわり（2026-08-26 ユーザー指示）
test('★アイコン選びはふだん閉じておく', () => {
  const src = readFileSync(new URL('../components/V2Profile.jsx', import.meta.url), 'utf8')
  assert.match(src, /useState\(false\)[^\n]*\n?/, 'state が無い')
  assert.ok(/const \[openAvatar, setOpenAvatar\] = useState\(false\)/.test(src), '閉じた状態で始まっていない')
  assert.match(src, /openAvatar \? '▲ アイコンを選ぶ（閉じる）' : '▼ アイコンを選ぶ'/, '開け閉めのボタンが無い')
  assert.match(src, /\{openAvatar && \(<>/, '中身を折りたたんでいない')
})

test('★プロフィールで図鑑ぶんの上がり幅が見られる', () => {
  const src = readFileSync(new URL('../components/V2Profile.jsx', import.meta.url), 'utf8')
  assert.match(src, /dexStats\(dex\?\.kills, dex\?\.found\)/, '図鑑ぶんを出していない')
  assert.match(src, /k1="図鑑"/, '図鑑の行が無い')
  assert.match(src, /STAT_DEFS\[k\]\.label\}\+\$\{dexBonus\[k\]\}/, '内訳を出していない')
})

// ★「素材を登録したらちゃんとステータスが上がっているか」を端まで確かめる。
//   dexStats が正しくても、totalStats / toFighter へつながっていなければ意味がない
test('★素材の初回登録と討伐数が、戦闘に渡るステータスまで届いている', async () => {
  const { totalStats, toFighter } = await import('./loadout.js')
  const prof = {
    username:'ためし', class:'戦士', equipped:{}, skill_set:[],
    hp:1000, mp:200, str:100, dex:100, agi:100, int_stat:100, vit:100, luk:100,
  }
  const m = materialsOfEnemy('スライム')          // VIT の素材3種
  const none = totalStats(prof, [], [], [], undefined)
  assert.equal(none.vit, 100, '図鑑を渡さなければ素のまま')

  assert.equal(totalStats(prof, [], [], [], { kills:{}, found:new Set([m[0].id]) }).vit, 101, '素材1種で+1')
  assert.equal(totalStats(prof, [], [], [], { kills:{}, found:new Set(m.map(x => x.id)) }).vit, 103, '素材3種で+3')

  const both = { kills:{ スライム: 10 }, found:new Set(m.map(x => x.id)) }
  assert.equal(totalStats(prof, [], [], [], both).vit, 104, '素材3種＋討伐10体で+4')
  // ★戦闘に渡る形（runBattle が使う stats）にも同じ値が入っていること
  assert.equal(toFighter(prof, [], [], [], both).stats.vit, 104, '戦闘に届いていない')
  // 関係ないステータスは動かない
  assert.equal(toFighter(prof, [], [], [], both).stats.str, 100)
})
