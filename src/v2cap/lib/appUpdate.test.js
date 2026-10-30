// v2cap：ホームの帯の「🔄 更新」（node --test）
// 【確定】2026-10-31 ユーザー指示「スマホで確認するとき、いちいちアプリ消して確認する必要があるからゲーム内の更新で解決できるようにしたい」
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { updateApp } from './appUpdate.js'

// 呼ばれた順を記録する偽物
const fakes = ({ keys = ['bf-static-bf-v3', 'v2cap-art'], update = async () => {} } = {}) => {
  const log = []
  return {
    log,
    sw: { getRegistrations: async () => [{ update: () => { log.push('update'); return update() }, unregister: async () => { log.push('unregister') } }] },
    store: { keys: async () => keys, delete: async (k) => { log.push(`delete:${k}`); return true } },
    reload: () => log.push('reload'),
  }
}

test('【確定】新しい sw.js を取りにいく → 保存してあるものを全部消す → 読み直す（この順）', async () => {
  const f = fakes()
  await updateApp(f)
  assert.deepEqual(f.log, ['update', 'delete:bf-static-bf-v3', 'delete:v2cap-art', 'reload'])
})

test('【確定】登録は消さない（unregister すると通知の登録まで切れる）', async () => {
  const f = fakes()
  await updateApp(f)
  assert.ok(!f.log.includes('unregister'))
  assert.ok(!readFileSync(new URL('./appUpdate.js', import.meta.url), 'utf8').includes('.unregister('))
})

test('どこで失敗しても読み直しまで行く（古いままで止まらない）', async () => {
  const cases = [
    { sw: undefined, store: undefined },                                                    // 対応していない端末
    { sw: { getRegistrations: async () => { throw new Error('x') } } },                     // 登録が読めない
    { store: { keys: async () => { throw new Error('x') }, delete: async () => true } },    // 保存先が読めない
    { update: async () => { throw new Error('offline') } },                                 // 電波がない
  ]
  for (const c of cases) {
    const f = fakes(c.update ? { update: c.update } : {})
    await updateApp({ ...f, ...('sw' in c ? { sw: c.sw } : {}), ...('store' in c ? { store: c.store } : {}) })
    assert.equal(f.log.at(-1), 'reload')
  }
})

test('sw.js の返事が来なくても待ちすぎない', async () => {
  const f = fakes({ update: () => new Promise(() => {}) })
  await updateApp({ ...f, waitMs: 10 })
  assert.equal(f.log.at(-1), 'reload')
  assert.ok(f.log.includes('delete:v2cap-art'))
})

test('画面：帯の「旧版へ戻る」を「🔄 更新」に置き換えた', () => {
  const home = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(!home.includes('← 旧版へ戻る'), '旧版へ戻るは消す（ユーザー「使わないから消していい」）')
  assert.ok(home.includes("{busy ? '更新中…' : '🔄 更新'}"))
  assert.ok(home.includes('<UpdateButton />'), '帯に置く')
  assert.ok(home.includes('updateApp()'))
})
