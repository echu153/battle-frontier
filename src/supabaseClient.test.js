// ログイン情報の鍵の待ち時間が「無期限」に戻っていないかを確かめる(2026-11-05 の「読み込み中」固まり)。
// supabase-js は auth の lockAcquireTimeout を指定しないと undefined になり、鍵を握ったまま止まった
// タブが1つあるだけで、ほかのタブも開き直したタブも永久に「読み込み中...」になる。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supabase } from './supabase.js'

test('ログイン情報の鍵は有限の時間で諦めて奪う(無期限に待たない)', () => {
  const t = supabase.auth.lockAcquireTimeout
  assert.equal(typeof t, 'number', `lockAcquireTimeout が数字でない: ${t}`)
  assert.ok(t > 0 && t <= 10000, `lockAcquireTimeout が 0〜10秒の外: ${t}`)
})

test('ログインの保存先の名前は前と同じ(変わると全員ログアウトになる)', () => {
  assert.equal(supabase.auth.storageKey, 'sb-jxbcuqwqtstxgmpiruuu-auth-token')
})

test('ほかのログイン設定は既定のまま', () => {
  assert.equal(supabase.auth.persistSession, true)
  assert.equal(supabase.auth.autoRefreshToken, true)
  assert.equal(supabase.auth.detectSessionInUrl, true)
  assert.equal(supabase.auth.flowType, 'implicit')
})
