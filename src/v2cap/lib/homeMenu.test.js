import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { TOWER_NAME, TOWER_SHORT_NAME } from './tower.js'
import { MENU_HEAD } from './menuHeadList.js'
import { MENU_HEAD_DEFS, CAT_HEAD_DEFS, MENU_HEAD_DIR, menuHeadFileOf, menuHeadSrcOf, menuHeadReady } from './menuHead.js'
import { CHALLENGE_CATS } from './dungeon.js'
import { versionOf } from '../../../tools/v2cap-art-lib.mjs'

// 【確定】2026-10-31 ユーザー指示「メニューがバラバラになってるからそれぞれの役割ごとにまとめたい」
//   キャラクター（ユーザーの「プレイヤー関連」）・冒険・施設の3つ。中の並びもユーザーの指定どおり
const SRC = readFileSync(new URL('../pages/V2capHome.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // 手元は CRLF のことがある
const MENU_SRC = SRC.slice(SRC.indexOf('const MENU = ['), SRC.indexOf('const SCREEN_TITLE'))
const groups = MENU_SRC.split("{ title:'").slice(1).map(s => ({
  title: s.slice(0, s.indexOf("'")),
  head: s.match(/head:'(\w+)'/)?.[1],
  keys: [...s.matchAll(/\{ key:'(\w+)'/g)].map(m => m[1]),
}))

test('メニューは役割ごとの3つ：キャラクター・冒険・施設（並びもユーザーの指定どおり）', () => {
  assert.deepEqual(groups, [
    { title:'キャラクター', head:'chara', keys:['profile', 'skills', 'equip', 'asc', 'dex'] },
    { title:'冒険', head:'adventure', keys:['dungeon', 'tower', 'training'] },   // 日替わりクエスト（旧 修練場）は 2026-11-06（毎日の案山子＋曜日のクエスト）
    { title:'施設', head:'facility', keys:['shop', 'temple', 'smith', 'museum', 'burger', 'casino', 'tree'] },
  ])
})

test('【確定】見出しの帯：3つとも絵があり、アドレスに絵の中身の印が付く（描き直しても古いキャッシュが出ない）', () => {
  assert.deepEqual(Object.keys(MENU_HEAD_DEFS), groups.map(g => g.head))
  for (const key of Object.keys(MENU_HEAD_DEFS)) {
    const file = new URL(`../../../public${MENU_HEAD_DIR}/${menuHeadFileOf(key)}`, import.meta.url)
    assert.ok(existsSync(file), `${key} の絵が無い（node tools/v2cap-menu-art.mjs）`)
    assert.equal(MENU_HEAD[key].v, versionOf(file), `${key}：絵と一覧の印が違う（node tools/v2cap-menu-art.mjs）`)
    assert.ok(menuHeadSrcOf(key).endsWith(`?v=${MENU_HEAD[key].v}`))
  }
})

test('見出しの帯は横幅いっぱいのまま高さだけ変わる（幅を固定しないと max-height に引かれて帯の幅が縮む・はみ出す）', () => {
  const status = readFileSync(new URL('../components/V2Status.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(status.includes("width:'100%', aspectRatio:'6 / 1', minHeight:'56px', maxHeight:'80px'"))
  assert.ok(status.includes('url(${menuHeadSrcOf(head)}) right center / auto 100% no-repeat'), '絵は高さに合わせて右へ寄せる（どの幅でも絵が切れない）')
  assert.ok(status.includes('<MenuHead head={group.head} title={group.title} />'))
})

test('【確定】2026-11-06 ユーザー「四凶のところ、ちょっとアイコン？バナーみたいなの差し込みたい」→選んだ「見出しの帯」「厚塗り」：挑戦のカテゴリの見出しにもホームと同じ帯（絵が届くまでは文字だけ）', () => {
  assert.equal(CHALLENGE_CATS.find(c => c.key === 'rival').head, 'rival')
  for (const c of CHALLENGE_CATS) if (c.head) assert.ok(CAT_HEAD_DEFS[c.head], `${c.label} の帯の決まりが無い`)
  assert.equal(CAT_HEAD_DEFS.rival.dir, 'エネミー/IDダンジョン', 'ユーザーが置いた所（ボスの絵と同じフォルダ）')
  assert.ok(!Object.keys(MENU_HEAD_DEFS).some(k => k in CAT_HEAD_DEFS), 'ホームの帯と名前がかぶらない')
  // 絵ができていれば一覧の印と同じ（できるまでは menuHeadReady が false＝文字だけ）
  for (const key of Object.keys(CAT_HEAD_DEFS)) {
    assert.equal(menuHeadReady(key), !!MENU_HEAD[key])
    if (!MENU_HEAD[key]) continue
    const file = new URL(`../../../public${MENU_HEAD_DIR}/${menuHeadFileOf(key)}`, import.meta.url)
    assert.ok(existsSync(file), `${key} の絵が無い（node tools/v2cap-menu-art.mjs）`)
    assert.equal(MENU_HEAD[key].v, versionOf(file), `${key}：絵と一覧の印が違う（node tools/v2cap-menu-art.mjs）`)
  }
  const dungeon = readFileSync(new URL('../components/V2capDungeon.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(dungeon.includes('cat.head && menuHeadReady(cat.head) ? <MenuHead head={cat.head} title={cat.label} />'))
  assert.ok(dungeon.includes("fontWeight:'bold', marginBottom:'8px' }}>{cat.label}</div>}"), '絵が届くまでは文字だけ')
  const ignore = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8')
  for (const def of Object.values(CAT_HEAD_DEFS)) assert.ok(ignore.includes(`/public/${def.dir.split('/')[0]}/`), `${def.source}：元の絵は git に入れない`)
  assert.ok(readFileSync(new URL('../../../tools/v2cap-menu-art.mjs', import.meta.url), 'utf8').includes('...CAT_HEAD_DEFS'), '道具も挑戦の帯を切り抜く')
})

test('メニューのどれを押しても、題と中身のある画面へ行ける', () => {
  const titles = SRC.slice(SRC.indexOf('const SCREEN_TITLE'), SRC.indexOf('// ATBの試し撃ち'))
  for (const key of groups.flatMap(g => g.keys)) {
    assert.ok(titles.includes(`${key}:`), `${key} の題が無い`)
    assert.ok(SRC.includes(`{screen === '${key}' && `), `${key} の画面が無い`)
  }
})

test('【確定】どのボタンも同じ大きさ：その行に1つしかなくても横いっぱいに伸ばさない', () => {
  const status = readFileSync(new URL('../components/V2Status.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const menu = status.slice(status.indexOf('export function V2Menu'))
  assert.ok(menu.includes("gridTemplateColumns:'1fr 1fr'"), '2列に流す')
  assert.ok(!menu.includes('gridColumn:'), '1つだけ伸ばすと大きさがそろわない')
  assert.ok(menu.includes('{group.title}'), 'まとまりの見出しを出す')
})

test('【確定】メニューの塔の札は「覇天塔」だけ（塔の画面の題などは正式な名前のまま）', () => {
  assert.equal(TOWER_SHORT_NAME, '覇天塔')
  assert.ok(TOWER_NAME.endsWith(TOWER_SHORT_NAME), '正式な名前の後ろと同じ')
  assert.ok(SRC.includes("{ key:'tower', label: TOWER_SHORT_NAME,"))
  assert.ok(SRC.includes('tower:`🗼 ${TOWER_NAME}`'), '塔の画面の題は正式な名前')
})
