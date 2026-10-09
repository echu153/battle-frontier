// ============================================================
// v2cap（レベルキャップあり版）SQLの種を JS から作り直す
// ------------------------------------------------------------
// supabase_v2cap_core.sql の「-- @@seed:名前」〜「-- @@end:名前」のあいだを、
// src/v2cap/lib の値から作った INSERT に差し替える（手で書き写さない）。
//   ・stages  … 段階（必要ジョブEXPの倍率・ステの量・スキルを覚えるジョブLV）
//   ・classes … 職業（段階・就く条件・ジョブLVで上がるステの並び）
//   ・tiers   … 難易度帯（LV帯・次の帯が開くのに要る踏破数）
//   ・areas   … エリア（帯・名前・落ちるランク）
//   ・enemies … 敵のLVと役割
//
//   node tools/v2cap-sql.mjs          … 差分があるかだけ表示
//   node tools/v2cap-sql.mjs --write  … SQLへ書き込む
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const B = new URL('../src/', import.meta.url).href
const { STAGES, STAGE_ORDER, CLASSES, bonusSeqOf } = await import(B + 'v2cap/lib/jobs.js')
const { TIER_LV, ENEMY_LEVELS } = await import(B + 'v2cap/lib/areas.js')
const { AREAS_SORTED } = await import(B + 'v2/lib/enemies.js')
const { TIER_REQ } = await import(B + 'v2/lib/sortie.js')

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const arr = (list, cast = '') => `'{${list.join(',')}}'${cast}`

export const seeds = () => ({
  stages: [
    'insert into public.v2cap_stages (stage, mult, per_lv, learn_at) values',
    STAGE_ORDER.map(k => `  (${q(k)}, ${STAGES[k].mult}, ${STAGES[k].perLv}, ${arr(STAGES[k].learnAt, '::int[]')})`).join(',\n'),
    'on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at;',
  ].join('\n'),
  classes: [
    'insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq) values',
    CLASSES.map(c => `  (${q(c.id)}, ${q(c.stage)}, ${c.sort}, ${c.req ? q(c.req.cls) : 'null'}, ${c.req ? c.req.jlv : 'null'}, ${arr(bonusSeqOf(c.id), '::text[]')})`).join(',\n'),
    'on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,',
    '  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq;',
  ].join('\n'),
  tiers: [
    'insert into public.v2cap_tiers (tier, lv_min, lv_max, req) values',
    Object.entries(TIER_LV).map(([t, [a, b]]) => `  (${t}, ${a}, ${b}, ${TIER_REQ[t] || 1})`).join(',\n'),
    'on conflict (tier) do update set lv_min = excluded.lv_min, lv_max = excluded.lv_max, req = excluded.req;',
  ].join('\n'),
  areas: [
    'insert into public.v2cap_areas (id, tier, name, drop_ranks) values',
    AREAS_SORTED.map(a => `  (${a.id}, ${a.tier}, ${q(a.name)}, ${q(JSON.stringify(a.dropRanks))}::jsonb)`).join(',\n'),
    'on conflict (id) do update set tier = excluded.tier, name = excluded.name, drop_ranks = excluded.drop_ranks;',
  ].join('\n'),
  enemies: [
    // ★敵は消してから入れ直す（名前を変えたときに古い行が残らないように）。参照している外部キーは無い
    'delete from public.v2cap_enemies;',
    'insert into public.v2cap_enemies (name, area, lv, role) values',
    ENEMY_LEVELS.map(e => `  (${q(e.name)}, ${e.area}, ${e.lv}, ${q(e.role)})`).join(',\n') + ';',
  ].join('\n'),
})

export const SQL_PATH = new URL('../supabase_v2cap_core.sql', import.meta.url)

// SQLの中の種を差し替えた全文を返す
export const rewrite = (sql, s = seeds()) => {
  let out = sql
  for (const [name, body] of Object.entries(s)) {
    const re = new RegExp(`(-- @@seed:${name}\\r?\\n)[\\s\\S]*?(-- @@end:${name})`)
    if (!re.test(out)) throw new Error(`SQLに -- @@seed:${name} 〜 -- @@end:${name} がありません`)
    out = out.replace(re, (_, a, b) => `${a}${body}\n${b}`)
  }
  return out
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/v2cap-sql.mjs')) {
  const sql = readFileSync(SQL_PATH, 'utf8')
  const next = rewrite(sql)
  if (next === sql) {
    console.log('SQLの種はJSと一致しています')
  } else if (process.argv.includes('--write')) {
    writeFileSync(SQL_PATH, next)
    console.log('SQLの種を書き直しました')
  } else {
    console.log('SQLの種がJSと食い違っています。--write で書き直してください')
    process.exitCode = 1
  }
}
