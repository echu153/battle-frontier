import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORIES, CATEGORY_KEYS, SEEN_KEY,
  byCategory, categoryDef, categoryOf, firstTabOf, hasNewIn, initialSeen, sortNewest, unreadOf,
} from './announce.js'

const a = (id, category, day) => ({ id, title:`お知らせ${id}`, content:'本文', category, created_at:`2026-09-0${day}T00:00:00Z` })

test('種類は アップデート・不具合・イベント の3つ', () => {
  assert.deepEqual(CATEGORY_KEYS, ['update', 'bug', 'event'])
  assert.deepEqual(CATEGORIES.map(c => c.label), ['アップデート', '不具合', 'イベント'])
})

// ★書いたのにどこにも出ない、が一番まずい
test('種類が空・知らない値でも消えずにアップデートへ寄る', () => {
  assert.equal(categoryOf({ category:'event' }), 'event')
  assert.equal(categoryOf({ category:null }), 'update')
  assert.equal(categoryOf({ category:'notice' }), 'update')   // 旧版にあった値
  assert.equal(categoryOf(undefined), 'update')
  assert.equal(categoryDef('nope').key, 'update')
})

test('新しい順に並ぶ', () => {
  const list = [a(1, 'update', 1), a(3, 'bug', 3), a(2, 'event', 2)]
  assert.deepEqual(sortNewest(list).map(x => x.id), [3, 2, 1])
  assert.deepEqual(sortNewest(null), [])
  // 元の配列を壊さない
  assert.deepEqual(list.map(x => x.id), [1, 3, 2])
})

// ★ここが本体。記録の無い端末で過去ぶんを全部浴びせない
test('既読の記録が無い端末は、いま在るぶんを全部既読にして始める', () => {
  const list = [a(1, 'update', 1), a(2, 'bug', 2)]
  assert.deepEqual(initialSeen(list, null), [1, 2])
  assert.deepEqual(unreadOf(list, initialSeen(list, null)), [])
  // 記録があるならそのまま使う（＝新しく増えたぶんだけ未読になる）
  assert.deepEqual(initialSeen(list, [1]), [1])
  assert.deepEqual(unreadOf(list, [1]).map(x => x.id), [2])
  // 空の記録（[]）は「全部未読」＝ null と区別する
  assert.deepEqual(initialSeen(list, []), [])
  assert.deepEqual(unreadOf(list, []).map(x => x.id), [1, 2])
})

test('タブごとの絞り込みとNEWの目印', () => {
  const list = [a(1, 'update', 1), a(2, 'bug', 2), a(3, 'event', 3)]
  assert.deepEqual(byCategory(list, 'bug').map(x => x.id), [2])
  assert.equal(hasNewIn(list, 'bug', new Set([2])), true)
  assert.equal(hasNewIn(list, 'bug', new Set([3])), false)
  assert.equal(hasNewIn(list, 'bug', [2]), true)      // 配列でも動く
  assert.equal(hasNewIn(list, 'bug', null), false)
})

// 新着があるのに別のタブが開いていて気付かない、を防ぐ
test('最初に開くタブは新着のある種類', () => {
  const list = [a(1, 'update', 1), a(2, 'bug', 2), a(3, 'event', 3)]
  assert.equal(firstTabOf(list, new Set([3])), 'event')
  assert.equal(firstTabOf(list, new Set([2, 3])), 'bug')   // 前にある種類を優先
  assert.equal(firstTabOf(list, new Set()), 'update')
})

// ===== SQL と画面の突き合わせ =====
test('★SQLに v2_announcements があり、プレイヤーには select しか許していない', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.v2_announcements/, 'テーブルが無い')
  assert.match(sql, /alter table public\.v2_announcements enable row level security/, 'RLSが入っていない')
  assert.match(sql, /grant select on table public\.v2_announcements to authenticated/, 'selectを許可していない')
  // insert / update / delete をプレイヤーへ渡していないこと（渡すと誰でもお知らせを書ける）
  assert.ok(!/grant (insert|update|delete|all)[^;]*on table public\.v2_announcements to authenticated/.test(sql),
    'プレイヤーに書き込みを許してしまっている')
  assert.match(sql, /revoke all on table public\.v2_announcements from anon/, 'anon を止めていない')
})

test('★画面はお知らせを読むだけ（書き込み・削除をしない）', async () => {
  const { readFileSync } = await import('node:fs')
  const home = readFileSync(new URL('../pages/V2Home.jsx', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../components/V2Announce.jsx', import.meta.url), 'utf8')
  assert.match(home, /from\('v2_announcements'\)\s*\n?\s*\.select\(/, '読み込んでいない')
  for (const src of [home, panel]) {
    assert.ok(!/from\('v2_announcements'\)[\s\S]{0,80}\.(insert|update|delete|upsert)\(/.test(src),
      '画面から書き込もうとしている')
  }
  // メニューから行ける／新着でポップアップが出る
  assert.match(home, /key:'announce'/, 'メニューに無い')
  assert.match(home, /screen === 'announce'/, '画面へ繋いでいない')
  assert.match(home, /V2AnnouncePopup/, 'ポップアップを出していない')
  // 既読の置き場は localStorage（サーバーに列を増やさない）
  assert.equal(SEEN_KEY, 'seenAnnounce')
  assert.match(home, /savePref\(ANN_SEEN/, '既読を保存していない')
})
