// ============================================================
// v2cap（レベルキャップあり版）SQLの種を JS から作り直す
// ------------------------------------------------------------
// supabase_v2cap_core.sql の「-- @@seed:名前」〜「-- @@end:名前」のあいだを、
// src/v2cap/lib の値から作った INSERT に差し替える（手で書き写さない）。
//   ・stages    … 段階（必要ClassEXPの倍率・ステの量・スキルを覚えるClassLV・ClassLVの上限・必要ClassEXPに毎回足す量）
//   ・classes   … 職業（段階・就く条件・ClassLVで上がるステの並び・装備できる武器・通常攻撃の種類・
//                  スキルを使える職業＝自分と下位職・ClassLVが上がるたびに必ず上がるHPとMP・キャラ作成で配る初期装備）
//   ・skills    … スキルの名簿（名前・職業・消費MP・覚える順）
//   ・equipment … 装備の一覧（エリア×レア度×種類の1560点＋初期装備19点。名前・部位・種類・系統・エリア・レア度・必要LV）
//   ・spots     … 場所（15エリア×①②③。経験値とGoldの範囲・敵のLVの範囲）
//   ・enemies   … 敵（いる場所・LV・役割・時間帯）
//   ・daily_tasks … デイリーミッション（数えるキー・名前・目標の回数）
//   ・asc_nodes … アセンションの盤面の形（段階ごと。マスの番号とつながり＝ascLayout.js）
//   ・asc_mp    … アセンションのMPのマス（職業ごと。スキル編成の最大MP用＝ascension.js の mpNodesOf）
//
//   node tools/v2cap-sql.mjs          … 差分があるかだけ表示
//   node tools/v2cap-sql.mjs --write  … SQLへ書き込む
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const B = new URL('../src/', import.meta.url).href
const { STAGES, STAGE_ORDER, CLASSES, bonusSeqOf, lineageOf, JOB_LV_HPMP } = await import(B + 'v2cap/lib/jobs.js')
const { SKILLS, isPassive } = await import(B + 'v2cap/lib/skills.js')
const { ITEMS, STARTER_ITEMS, UNIQUE_ITEMS, starterIdsOf } = await import(B + 'v2cap/lib/equipment.js')
const { SPOTS, spotLvOf, enemyLevels, recLvOf } = await import(B + 'v2cap/lib/areas.js')
const { DAILY_TASKS } = await import(B + 'v2cap/lib/daily.js')
const { mpNodesOf, ASC_CLASSES } = await import(B + 'v2cap/lib/ascension.js')
const { ASC_LAYOUT } = await import(B + 'v2cap/lib/ascLayout.js')
const { SHINKA_MAX, SHINKA_COST_PCT, SHINKA_MIN_DEN, SREC_FIELDS, FLAGS, ABILITIES, flagWeightOf } = await import(B + 'v2cap/lib/shinka.js')
const { RACES, RACE_NAMES } = await import(B + 'v2cap/lib/monsterRace.js')

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const arr = (list, cast = '') => `'{${list.join(',')}}'${cast}`

// 職業ごとに「名簿の中で何番目か」＝覚える順（sort）
const sortOf = (() => {
  const seen = {}
  const out = {}
  for (const s of SKILLS) { seen[s.cls] = (seen[s.cls] || 0) + 1; out[s.name] = seen[s.cls] }
  return out
})()

export const seeds = () => ({
  stages: [
    'insert into public.v2cap_stages (stage, mult, per_lv, learn_at, max_jlv, need_base) values',
    STAGE_ORDER.map(k => `  (${q(k)}, ${STAGES[k].mult}, ${STAGES[k].perLv}, ${arr(STAGES[k].learnAt, '::int[]')}, ${STAGES[k].max}, ${STAGES[k].needBase || 0})`).join(',\n'),
    'on conflict (stage) do update set mult = excluded.mult, per_lv = excluded.per_lv, learn_at = excluded.learn_at, max_jlv = excluded.max_jlv, need_base = excluded.need_base;',
  ].join('\n'),
  classes: [
    // ★なくした職業（ノーブル・サモナー・上位職）を消してから入れ直す。参照している外部キーは無い
    //   （キャラの職業は §2 の一度だけの作り直しで消えている）
    `delete from public.v2cap_classes where id <> all(${arr(CLASSES.map(c => c.id), '::text[]')});`,
    'insert into public.v2cap_classes (id, stage, sort, req_cls, req_jlv, bonus_seq, weapons, kind, lineage, lv_hp, lv_mp, starter) values',
    CLASSES.map(c => `  (${q(c.id)}, ${q(c.stage)}, ${c.sort}, ${c.req ? q(c.req.cls) : 'null'}, ${c.req ? c.req.jlv : 'null'}, ${arr(bonusSeqOf(c.id), '::text[]')}, ${arr(c.weapons, '::text[]')}, ${q(c.kind)}, ${arr(lineageOf(c.id), '::text[]')}, ${JOB_LV_HPMP[c.id]?.hp || 0}, ${JOB_LV_HPMP[c.id]?.mp || 0}, ${arr(starterIdsOf(c.id), '::text[]')})`).join(',\n'),
    'on conflict (id) do update set stage = excluded.stage, sort = excluded.sort,',
    '  req_cls = excluded.req_cls, req_jlv = excluded.req_jlv, bonus_seq = excluded.bonus_seq,',
    '  weapons = excluded.weapons, kind = excluded.kind, lineage = excluded.lineage,',
    '  lv_hp = excluded.lv_hp, lv_mp = excluded.lv_mp, starter = excluded.starter;',
    // 使われなくなった段階（上位）を消す
    `delete from public.v2cap_stages s where s.stage <> all(${arr(STAGE_ORDER, '::text[]')})`,
    '  and not exists (select 1 from public.v2cap_classes c where c.stage = s.stage);',
  ].join('\n'),
  skills: [
    // ★消してから入れ直す（名前を変えた・職業をなくしたときに古い行が残らないように）。参照している外部キーは無い
    'delete from public.v2cap_skills;',
    // ★uses_max … 回数の上限がある技（狂鬼化＝1 など・2026-10-15）。無ければ null
    'insert into public.v2cap_skills (name, cls, mp, sort, passive, uses_max) values',
    SKILLS.map(s => `  (${q(s.name)}, ${q(s.cls)}, ${s.mp || 0}, ${sortOf[s.name]}, ${isPassive(s) ? 'true' : 'false'}, ${s.usesMax ?? 'null'})`).join(',\n') + ';',
  ].join('\n'),
  equipment: [
    // ★持ち物（v2cap_inventory）が参照するので消さずに入れ直す。一覧から外れた行は §2 の作り直しのあとで消す
    'insert into public.v2cap_equipment (id, name, part, type, line, area, rarity, lv, spot) values',
    // ★初期装備（エリア0・必要LV1・2026-10-12）とユニーク（ボス固有・必要LV80・spot＝落とすボスの場所・2026-10-21）も同じ表に入れる
    [...ITEMS, ...STARTER_ITEMS, ...UNIQUE_ITEMS].map(i => `  (${q(i.id)}, ${q(i.name)}, ${q(i.part)}, ${q(i.type)}, ${i.line ? q(i.line) : 'null'}, ${i.area}, ${q(i.rarity)}, ${i.lv}, ${i.spot ?? 'null'})`).join(',\n'),
    'on conflict (id) do update set name = excluded.name, part = excluded.part, type = excluded.type, line = excluded.line,',
    '  area = excluded.area, rarity = excluded.rarity, lv = excluded.lv, spot = excluded.spot;',
  ].join('\n'),
  spots: [
    // ★消してから入れ直す（場所の数を変えたときに古い行が残らないように）。参照している外部キーは無い
    'delete from public.v2cap_spots;',
    'insert into public.v2cap_spots (id, area, sub, area_name, name, exp_min, exp_max, gold_min, gold_max, lv_min, lv_max, rec_lv) values',
    SPOTS.map(s => {
      const [lo, hi] = spotLvOf(s.id)
      return `  (${s.id}, ${s.area}, ${s.sub}, ${q(s.areaName)}, ${q(s.name)}, ${s.exp[0]}, ${s.exp[1]}, ${s.gold[0]}, ${s.gold[1]}, ${lo}, ${hi}, ${recLvOf(s.id)})`
    }).join(',\n') + ';',
  ].join('\n'),
  enemies: [
    // ★敵は消してから入れ直す（名前を変えたときに古い行が残らないように）。参照している外部キーは無い
    'delete from public.v2cap_enemies;',
    'insert into public.v2cap_enemies (name, spot, lv, role, band) values',
    enemyLevels().map(e => `  (${q(e.name)}, ${e.spot}, ${e.lv}, ${q(e.role)}, ${e.band ? q(e.band) : 'null'})`).join(',\n') + ';',
  ].join('\n'),
  daily_tasks: [
    // ★一覧から外したミッションを消してから入れ直す（参照している外部キーは無い。進みは profiles の jsonb にキーで入っている）
    `delete from public.v2cap_daily_tasks where key <> all(${arr(DAILY_TASKS.map(t => t.key), '::text[]')});`,
    'insert into public.v2cap_daily_tasks (key, label, goal, sort) values',
    DAILY_TASKS.map((t, i) => `  (${q(t.key)}, ${q(t.label)}, ${t.goal}, ${i + 1})`).join(',\n'),
    'on conflict (key) do update set label = excluded.label, goal = excluded.goal, sort = excluded.sort;',
  ].join('\n'),
  asc_nodes: [
    // ★消してから入れ直す（形を変えたときに古いマスが残らないように）。参照している外部キーは無い。
    //   プレイヤーが開いたマスの番号は v2cap_profiles.ascension にある＝形を変えたら、振ったAPをどうするかユーザーと決める
    'delete from public.v2cap_asc_nodes;',
    'insert into public.v2cap_asc_nodes (stage, id, links) values',
    Object.entries(ASC_LAYOUT).flatMap(([stage, L]) => L.nodes.map(n => `  (${q(stage)}, ${n.id}, ${arr(n.links, '::int[]')})`)).join(',\n') + ';',
  ].join('\n'),
  asc_mp: (() => {
    // MPの小マス・MPの大マスだけ（スキル編成の最大MP＝ v2cap_asc_mp）
    const rows = ASC_CLASSES.flatMap(cls => mpNodesOf(cls).map(m => `  (${q(cls)}, ${m.id}, ${m.mp}, ${m.pct})`))
    return ['delete from public.v2cap_asc_mp;', ...(rows.length ? ['insert into public.v2cap_asc_mp (cls, id, mp, pct) values', rows.join(',\n') + ';'] : [])].join('\n')
  })(),
  // ===== 武器の真化（§18・2026-10-26・shinka.js）=====
  // 熟練度MAX・代償つきが出る確率・フラグの分母の最低
  shinka_conf: [
    'delete from public.v2cap_shinka_conf;',
    'insert into public.v2cap_shinka_conf (k, v) values',
    `  ('max', ${SHINKA_MAX}),\n  ('cost_pct', ${SHINKA_COST_PCT}),\n  ('min_den', ${SHINKA_MIN_DEN});`,
  ].join('\n'),
  // 画面が送る記録の項目（1戦ぶんの上限 cap・同じ戦闘のその項目を超えない le・勝ったときだけ win_only）
  shinka_fields: [
    'delete from public.v2cap_shinka_fields;',
    'insert into public.v2cap_shinka_fields (key, cap, le, win_only, sort) values',
    SREC_FIELDS.map((f, i) => `  (${q(f.key)}, ${f.cap}, ${f.le ? q(f.le) : 'null'}, ${f.winOnly ? 'true' : 'false'}, ${i + 1})`).join(',\n') + ';',
  ].join('\n'),
  // フラグ（num ÷ den を境目 th と比べる・special＝race／band）。has_cost＝代償つきの能力があるか・weight＝抽選のくじ
  shinka_flags: [
    'delete from public.v2cap_shinka_flags;',
    'insert into public.v2cap_shinka_flags (key, num, den, dir, th, special, has_cost, weight, sort) values',
    FLAGS.map((f, i) => `  (${q(f.key)}, ${f.num ? q(f.num) : 'null'}, ${f.den ? q(f.den) : 'null'}, ${f.dir ? q(f.dir) : 'null'}, ${f.th ?? 'null'}, ${f.special ? q(f.special) : 'null'}, ${ABILITIES[f.key]?.alt ? 'true' : 'false'}, ${flagWeightOf(f.key)}, ${i + 1})`).join(',\n') + ';',
  ].join('\n'),
  // 種族（並び＝キラーの同じ数のときの順）
  races: [
    'delete from public.v2cap_races;',
    'insert into public.v2cap_races (key, label, sort) values',
    RACES.map((r, i) => `  (${q(r.key)}, ${q(r.label)}, ${i + 1})`).join(',\n') + ';',
  ].join('\n'),
  // モンスターの種族（安息の祠のハピネスフェアリーも）
  monster_race: [
    'delete from public.v2cap_monster_race;',
    'insert into public.v2cap_monster_race (name, race) values',
    Object.entries(RACE_NAMES).flatMap(([race, names]) => names.map(n => `  (${q(n)}, ${q(race)})`)).join(',\n') + ';',
  ].join('\n'),
})

export const SQL_PATH = new URL('../supabase_v2cap_core.sql', import.meta.url)

// SQLの中の種を差し替えた全文を返す
// ★改行はSQLファイルに合わせる。Windowsで取り出し直すとファイルは CRLF になるので、種を LF で書くと
//   「種がJSと食い違う」と出てしまう（2026-10-09 取り出し直した作業場所で実際に踏んだ）
export const rewrite = (sql, s = seeds()) => {
  const eol = sql.includes('\r\n') ? '\r\n' : '\n'
  let out = sql
  for (const [name, body] of Object.entries(s)) {
    const re = new RegExp(`(-- @@seed:${name}\\r?\\n)[\\s\\S]*?(-- @@end:${name})`)
    if (!re.test(out)) throw new Error(`SQLに -- @@seed:${name} 〜 -- @@end:${name} がありません`)
    out = out.replace(re, (_, a, b) => `${a}${body.replace(/\n/g, eol)}${eol}${b}`)
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
