// バトルフロンティアⅡ 画面の設定の保存の回帰テスト（node --test）
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadPref, savePref, mergePref } from './prefs.js'

// node には localStorage が無いので差し込む
const fake = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  }
}
beforeEach(() => { globalThis.localStorage = fake() })

test('保存して読み戻せる（型もそのまま）', () => {
  savePref('openStatus', false)
  assert.equal(loadPref('openStatus', true), false)
  savePref('part', '武器')
  assert.equal(loadPref('part', 'すべて'), '武器')
  savePref('filter', { rank:'S', asc:true })
  assert.deepEqual(loadPref('filter', {}), { rank:'S', asc:true })
})

test('保存が無ければ既定値を返す', () => {
  assert.equal(loadPref('なにもない', true), true)
  assert.equal(loadPref('なにもない', 'すべて'), 'すべて')
})

test('キーは v2: で始める（旧版の設定とぶつからないように）', () => {
  savePref('openMenu', true)
  assert.ok(globalThis.localStorage._map.has('v2:openMenu'))
})

test('壊れた値が入っていても既定値に落ちる', () => {
  globalThis.localStorage.setItem('v2:filter', '{壊れたJSON')
  assert.deepEqual(loadPref('filter', { rank:'すべて' }), { rank:'すべて' })
})

test('localStorage が使えない環境でも落ちない', () => {
  delete globalThis.localStorage
  assert.equal(loadPref('openStatus', true), true)
  assert.doesNotThrow(() => savePref('openStatus', false))
})

test('★オブジェクトは既定値にあるキーだけ拾う（項目を足しても壊れない）', () => {
  const now = { rank:'すべて', type:'すべて', plus:'すべて', sort:'power', asc:false }
  // 「強化値(plus)」を足す前に保存された古い設定
  globalThis.localStorage.setItem('v2:f', JSON.stringify({ rank:'S', type:'剣', sort:'name', asc:true }))
  const merged = mergePref('f', now)
  assert.deepEqual(merged, { rank:'S', type:'剣', plus:'すべて', sort:'name', asc:true })
  // 余計なキーは持ち込まない
  globalThis.localStorage.setItem('v2:g', JSON.stringify({ rank:'A', 知らない項目: 1 }))
  assert.deepEqual(Object.keys(mergePref('g', now)).sort(), Object.keys(now).sort())
})

test('オブジェクト以外が入っていたら既定値をそのまま使う', () => {
  const now = { rank:'すべて' }
  globalThis.localStorage.setItem('v2:h', JSON.stringify('文字列'))
  assert.deepEqual(mergePref('h', now), now)
  globalThis.localStorage.setItem('v2:i', JSON.stringify([1, 2]))
  assert.deepEqual(mergePref('i', now), now)
  assert.deepEqual(mergePref('まだ無い', now), now)
})
