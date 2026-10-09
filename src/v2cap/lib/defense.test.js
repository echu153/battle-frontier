// 防御の式（この版だけ）：魔法防御＝INT×0.5＋VIT×0.5・物理防御はVITのまま（2026-10-09 ユーザー決定・10-10 入れた）（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  physDefOf, magDefOf, magDefCapOf, magDefByRule, damageOf, MAG_DEF_INT, MAG_DEF_VIT, CAP_MAG_DEF_INT, CAP_MAG_DEF_VIT,
} from '../../v2/lib/combat.js'
import { createSide, takeAction } from '../../v2/lib/battle.js'
import { CAP_RULES } from './rules.js'

const st = (over = {}) => ({ hp: 10000, mp: 500, str: 300, dex: 100, agi: 100, int_stat: 300, vit: 100, luk: 30, ...over })

test('【確定】この版の魔法防御は INT×0.5＋VIT×0.5・物理防御はVITのまま・今のⅡの式は変わらない', () => {
  assert.deepEqual([CAP_MAG_DEF_INT, CAP_MAG_DEF_VIT], [0.5, 0.5])
  const s = { int_stat: 40, vit: 200 }
  assert.equal(magDefCapOf(s), 40 * 0.5 + 200 * 0.5)
  assert.equal(magDefByRule(s, 'cap'), magDefCapOf(s))
  assert.equal(magDefByRule(s, null), magDefOf(s), '印が無ければ今のⅡの式')
  assert.equal(magDefOf(s), 40 * MAG_DEF_INT + 200 * MAG_DEF_VIT)
  assert.equal(CAP_RULES.defRule, 'cap')
  // ダメージ：VITが高くINTが低い受け手は、この版のほうが魔法を受けにくい。物理は同じ
  const atk = st()
  const def = st({ int_stat: 20, vit: 400 })
  const mag = (defRule) => damageOf({ attacker: atk, defender: def, mult: 1.5, kind: 'mag', defRule })
  const phy = (defRule) => damageOf({ attacker: atk, defender: def, mult: 1.5, kind: 'phys', defRule })
  assert.ok(mag('cap') < mag(null), `魔法 ${mag('cap')} ＜ ${mag(null)}`)
  assert.equal(phy('cap'), phy(null), '物理防御は変わらない')
  assert.equal(physDefOf(def), physDefOf(def))
})

test('戦闘：受ける側の印で魔法防御が切り替わる（印の無い今のⅡの戦闘は今のまま）', () => {
  const caster = (rule) => createSide({ name: '魔', cls: null, kind: 'mag', stats: st(), noClassBonus: true, passives: [], ...rule,
    slots: [{ skill: { name: '魔弾', cls: null, kind: 'mag', mult: 1.5, proc: 100, mp: 0, sureHit: true, noCrit: true }, uses: 9 }] })
  const tank = (rule) => createSide({ name: '盾', cls: null, kind: 'phys', stats: st({ int_stat: 20, vit: 400 }), noClassBonus: true, passives: [], slots: [], ...rule })
  const hit = (rule) => {
    const log = []
    takeAction(caster(rule), tank(rule), () => 0.5, log)
    return log.find(l => l.type === 'skill').damage
  }
  assert.ok(hit(CAP_RULES) < hit({}), 'この版ではVITで魔法も受けられる')
  assert.equal(tank({}).defRule, null)
})

test('戦闘エンジンでダメージを計算する所（resolveAttack）は、どこも受ける側の防御の式を渡している', () => {
  // ★一次職で計算する所が増えた（着地・反撃・召喚・物理＋魔法の魔法のぶん）。足したときの渡し忘れを見つける
  const src = readFileSync(new URL('../../v2/lib/battle.js', import.meta.url), 'utf8')
  const calls = (src.match(/resolveAttack\(\{/g) || []).length
  const passed = (src.match(/defRule: foe\.defRule/g) || []).length
  assert.ok(calls >= 4)
  assert.equal(passed, calls, `resolveAttack ${calls}か所 ／ defRule を渡しているのは ${passed}か所`)
})
