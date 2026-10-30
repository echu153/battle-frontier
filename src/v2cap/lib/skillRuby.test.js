// v2cap の敵の技の名前の読み方（ルビ）のテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKILL_RUBY, rubySegmentsOf } from './skillRuby.js'
import { BOSS_DEFS } from './bossArt.js'
import { DUNGEON_BOSSES } from './dungeon.js'

test('【確定】2026-10-30 IDダンジョンのボスの技はぜんぶ読み方がある（ユーザー「これIDダンジョンは全部これね、スキルの感じルぴ振れる？」）', () => {
  for (const [key, def] of Object.entries(BOSS_DEFS)) {
    for (const m of def.motions) assert.ok(SKILL_RUBY[m.file], `${key} の「${m.file}」の読み方（lib/skillRuby.js に足す）`)
  }
  // 2026-10-30 IDダンジョンのボスの技とHPの節目のバフ（同じ帯に出る）
  for (const [key, b] of Object.entries(DUNGEON_BOSSES)) {
    for (const n of [...b.skills.map(s => s.name), ...(b.pattern?.buffs || []).map(x => x.name)]) {
      assert.ok(SKILL_RUBY[n], `${key} の「${n}」の読み方（lib/skillRuby.js に足す）`)
    }
  }
  // ルビを外した字は技の名前と同じ・ルビはひらがなだけ
  for (const [name, src] of Object.entries(SKILL_RUBY)) {
    const segs = rubySegmentsOf(name)
    assert.equal(segs.map(s => s.text).join(''), name, `${name} の書き方（${src}）`)
    assert.ok(segs.some(s => s.ruby), `${name} にルビがある`)
    for (const s of segs) if (s.ruby) assert.match(s.ruby, /^[ぁ-んー]+$/, `${name} のルビはひらがな`)
  }
})

test('ルビの書き方：｜漢字《よみ》・ルビの無い字はそのまま・読み方の無い名前はそのまま1つ', () => {
  assert.deepEqual(rubySegmentsOf('焦熱の吐息'), [{ text: '焦熱', ruby: 'しょうねつ' }, { text: 'の' }, { text: '吐息', ruby: 'といき' }])
  assert.deepEqual(rubySegmentsOf('水天葬'), [{ text: '水天葬', ruby: 'すいてんそう' }])
  assert.deepEqual(rubySegmentsOf('知らない技'), [{ text: '知らない技' }])
})
