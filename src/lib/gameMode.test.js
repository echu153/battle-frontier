// どの版を作れるか／遊べるかの切り替え（node --test）
// ------------------------------------------------------------
// ★切り替えは gameMode.js の2行だけ。ここは「その2行を変えたときに
//   画面が正しくついてくるか」と「食い違う組み合わせを置いていないか」を見る。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { V2_PUBLIC, CREATE_MODE, CREATE_MODES, canCreate, creatableVersions, canPlayV2 } from './gameMode.js'

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// ★ここで「いまの値」を固定しない。固定すると、切り替えるたびにテストも直すことになって
//   「いつでも切り替えられる」ではなくなる（2026-08-26 ユーザー指示）。
//   見るのは**組み合わせが破綻していないか**だけ。
test('設定として成り立っている値が入っている', () => {
  assert.equal(typeof V2_PUBLIC, 'boolean')
  assert.ok(CREATE_MODES.includes(CREATE_MODE), `知らないモード: ${CREATE_MODE}`)
})

test('モードごとに作れる版が変わる', () => {
  const of = (mode) => ({
    v1: mode === 'v1only' || mode === 'both',
    v2: mode === 'v2only' || mode === 'both',
  })
  for (const mode of CREATE_MODES) {
    const want = of(mode)
    // canCreate は CREATE_MODE を見るので、ここでは今のモードだけ実物で確かめる
    if (mode !== CREATE_MODE) continue
    assert.equal(canCreate('v1'), want.v1, `${mode} の無印`)
    assert.equal(canCreate('v2'), want.v2, `${mode} のⅡ`)
  }
  // 知らない版は作れない
  assert.equal(canCreate('v3'), false)
})

test('★is_admin はいつでも両方作れる（作れないと開発中の確認ができない）', () => {
  assert.equal(canCreate('v1', true), true)
  assert.equal(canCreate('v2', true), true)
  assert.deepEqual(creatableVersions(true), ['v1', 'v2'])
})

test('作れる版が1つなら選ばせない', () => {
  const list = creatableVersions(false)
  assert.ok(list.length >= 1, '1つも作れないのはおかしい')
  if (CREATE_MODE === 'both') assert.equal(list.length, 2)
  else assert.equal(list.length, 1)
})

test('Ⅱに入れるかは V2_PUBLIC と is_admin で決まる', () => {
  assert.equal(canPlayV2(true), true, '管理者はいつでも入れる')
  assert.equal(canPlayV2(false), V2_PUBLIC)
})

// ★ここが食い違うと「Ⅱを作らせたのに /v2 へ入れない」行き止まりになる
test('★Ⅱを作らせるなら、Ⅱに入れるようにもなっていること', () => {
  const letsMakeV2 = CREATE_MODE === 'v2only' || CREATE_MODE === 'both'
  if (letsMakeV2) {
    assert.equal(V2_PUBLIC, true,
      'CREATE_MODE でⅡを作らせているのに V2_PUBLIC が false（作った先へ入れない）')
  }
})

// ★判定を画面へ散らさない。散らすと片方だけ直して食い違う
test('★版の判定は gameMode.js だけに書く', () => {
  const create = src('../pages/CharCreate.jsx')
  assert.match(create, /creatableVersions\(/, 'キャラ作成が判定を使っていない')
  assert.ok(!/const V2_PUBLIC = /.test(create), 'キャラ作成に古いフラグが残っている')
  const home = src('../v2/pages/V2Home.jsx')
  assert.match(home, /canPlayV2\(p\?\.is_admin, !!tester\)/, '/v2 のゲートが判定を使っていない')
  assert.ok(!/if \(!p\?\.is_admin\) \{ reportDevAccess/.test(home), '/v2 に古いゲートが残っている')
})

// ★Ⅱだけで始めた人は旧版の profiles に行が無い（v2_create_character は v2_profiles にしか書かない）。
//   ここを p.username と書くと、Ⅱ単独リリース後の新規が真っ白になる
test('★旧版のデータが無くてもⅡのホームが落ちない', () => {
  const home = src('../v2/pages/V2Home.jsx')
  assert.match(home, /setName\(p\?\.username \|\| ''\)/, 'profiles が無いと落ちる書き方になっている')
  assert.match(home, /setIsAdmin\(!!p\?\.is_admin\)/, 'profiles が無いと落ちる書き方になっている')
  // コメント行は動かないので見ない
  const code = home.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
  assert.ok(!/\bp\.username\b/.test(code), 'p.username を直に読んでいる')
  assert.ok(!/\bp\.is_admin\b/.test(code), 'p.is_admin を直に読んでいる')
})

test('Ⅱが公開されたら「開発中」の札を出さない', () => {
  const create = src('../pages/CharCreate.jsx')
  assert.match(create, /\{!V2_PUBLIC && <span[^>]*>\s*［開発中］/, '公開後も［開発中］が出たままになる')
})
