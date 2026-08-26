// バトルフロンティアⅡ SQL（supabase_v2_core.sql）とJS側の突き合わせ（node --test）
// ------------------------------------------------------------
// v2は「1ファイルにまとめて全文を流し直す」運用なので、SQLとJSに同じ数字が
// 2か所ある箇所がいくつかある。**片方だけ直したときに気付けるように**ここで固定する。
// 旧版の「SQL の定数がテストの写しと一致している」テストと同じ考え方。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { RATES } from './smith.js'
import { RANKS } from './equipment.js'
import { FORTUNES, PRAY_GOLD, PRAY_EXP } from './tree.js'
import { SELL_BASE_TIER, SELL_RARITY_MULT } from './material.js'
import { LOSE_DROP, floorAfterLose } from './arena.js'
import { SKILLS, OFF_CLASS_MP_MULT } from './skills.js'

const SQL = readFileSync(new URL('../../../supabase_v2_core.sql', import.meta.url), 'utf8')

// 関数の本体を切り出す（v2は同名オーバーロードを作らない運用）
const bodyOf = (name) => {
  const i = SQL.indexOf(`create or replace function public.${name}(`)
  assert.notEqual(i, -1, `${name} がSQLに無い`)
  const end = SQL.indexOf('\n$$;', i)
  assert.notEqual(end, -1, `${name} の終わりが見つからない`)
  return SQL.slice(i, end)
}

// ★消費MPは skills.js と v2_skills の2か所にある（サーバーが編成の想定利用MPを検証するため）。
//   倍率を下げたときにMPだけ据え置くと編成の重さが合わなくなるので、片方だけ直したら落とす。
test('v2_skills の名前・職業・消費MPが skills.js と一致している（片方だけ直すと気付く）', () => {
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_skills'))
  // ★2026-08-23：パッシブかどうかの列が増えた（枠を使わない＝抽選にも出ないし枠にも置けない）
  const end = seed.indexOf('on conflict')
  const body = end >= 0 ? seed.slice(0, end) : seed
  const rows = [...body.matchAll(/\('([^']+)','([^']+)',(\d+),(\d+),(\d+),(true|false)\)/g)]
  assert.equal(rows.length, SKILLS.length, 'v2_skills の行数がJS側と違う')
  const bySql = new Map(rows.map(m => [m[1], { cls: m[2], mp: Number(m[3]), reqJobs: Number(m[5]) }]))
  for (const s of SKILLS) {
    const row = bySql.get(s.name)
    assert.ok(row, `${s.name} が v2_skills に無い`)
    assert.equal(row.cls, s.cls, `${s.name} の職業`)
    assert.equal(row.mp, s.mp || 0, `${s.name} の消費MP`)
    // ★転職回数の条件（侍の納刀・見切り＝5回以上）もSQLと揃える
    assert.equal(row.reqJobs, s.reqJobs || 0, `${s.name} の必要転職回数`)
  }
})

// ★編成の想定利用MPは画面（setMpCost）とサーバー（v2_set_skills）の2か所で数える。
//   他職のスキルを2倍で数える規則がズレると「画面では保存できるのにサーバーに弾かれる」になる
test('v2_set_skills の他職スキルの消費MP倍率が skills.js と一致している', () => {
  const body = bodyOf('v2_set_skills')
  const line = body.split('\n').find(l => l.includes('c_off_mp') && l.includes('constant'))
  assert.ok(line, 'v2_set_skills に c_off_mp の宣言が無い')
  assert.equal(Number(line.split(':=')[1].replace(';', '').trim()), OFF_CLASS_MP_MULT)
  // 数えるときに実際に使っていること（定数を置いただけで使っていないと意味がない）
  assert.ok(body.includes('case when v_scls = v_row.class then v_mp else v_mp * c_off_mp end'),
    '想定利用MPの合計で c_off_mp を使っていない')
})

test('v2_fuse の確率表が smith.js の RATES と一致している（片方だけ直すと気付く）', () => {
  const body = bodyOf('v2_fuse')
  for (const rank of RANKS) {
    const r = RATES[rank]
    // SQL側は ('F', 0.00, 0.14, 0.04) のように (rank, fail, great, super) を小数で持つ
    const m = body.match(new RegExp(`\\('${rank}',\\s*([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)\\)`))
    assert.ok(m, `${rank} の行がSQLにある`)
    assert.equal(Math.round(Number(m[1]) * 100), r.fail,  `${rank} の失敗率`)
    assert.equal(Math.round(Number(m[2]) * 100), r.great, `${rank} の大成功率`)
    assert.equal(Math.round(Number(m[3]) * 100), r.super, `${rank} の超大成功率`)
  }
})

test('v2_sortie_settle はボス勝利数をボス遭遇数で頭打ちにする', () => {
  const body = bodyOf('v2_sortie_settle')
  // ★ここが無いと「遭遇1回・勝利10万回」を送れて、EXP/Goldの上限計算が青天井になる。
  //   回数の頭打ち（500）は v_n + v_bs にしか掛かっていないため、v_bw は別に抑える必要がある。
  assert.match(body, /v_bw\s*:=\s*least\(v_bw,\s*v_bs\)/,
    'v_bw := least(v_bw, v_bs) が要る')
  // 上限を組み立てるより前に抑えていること（順番が逆だと意味がない）
  //   ※ declare の `v_exp_cap int;` ではなく**代入**の位置と比べる
  const capAt = body.search(/v_exp_cap\s*:=/)
  assert.notEqual(capAt, -1, 'v_exp_cap の代入がある')
  assert.ok(body.indexOf('least(v_bw, v_bs)') < capAt, '頭打ちは上限計算より前で行う')
})

test('authenticated に開放しているv2のRPCは全部 is_admin を見ている（開発限定のまま）', () => {
  // ★画面（V2Home.jsx）のゲートだけだと、RPCを直接叩けば誰でもv2を遊べてしまう。
  //   旧版の arena/pvp と同じ穴なので、grant したものは必ずサーバー側でも弾く。
  // ★拾うのは「authenticated へ渡したもの」だけ。service_role にだけ渡したRPC
  //   （NPCを動かす v2_npc_* など。Edge Functionからしか呼べない）はプレイヤーの手が届かないので対象外
  const granted = [...SQL.matchAll(/grant execute on function public\.(v2_\w+)\([^)]*\) to authenticated;/g)].map(m => m[1])
  assert.ok(granted.length >= 15, `grant されたRPCを拾えている（${granted.length}件）`)
  const holes = [...new Set(granted)].filter(name => {
    const body = bodyOf(name)
    return !body.includes('v2_is_dev()') && !body.includes('is_admin')
  })
  assert.deepEqual(holes, [], `is_admin を見ていないRPC: ${holes.join(', ')}`)
})

test('v2_set_skills はルーンのMP+%を最大MPに乗せる（素の profiles.mp で判定しない）', () => {
  const body = bodyOf('v2_set_skills')
  // ★素の mp で判定すると、蒼ルーンのMPが**どこにも効かない**
  //   （戦闘はHP/MP満タン開始で決着5〜13ターン＝MPが枯れないため）
  assert.match(body, /v2_essences/, '装着中のルーンを見ている')
  assert.match(body, /stats\s*->>\s*'mp'/, 'ルーンのMP+%を読んでいる')
  assert.match(body, /if v_cost > v_max_mp then/, 'ルーンぶんを乗せた最大MPで判定している')
  assert.doesNotMatch(body, /if v_cost > v_row\.mp then/, '素の mp での判定が残っていない')
})

// ===== Gold（2026-08-17 ユーザー決定・docs/v2-gold-design.md）=====
test('v2_sortie_settle はGoldを足さない（敵はGoldを落とさない）', () => {
  const body = bodyOf('v2_sortie_settle')
  // ★ここが戻ると「敵からもGold・素材売却でもGold」の二重の湧き口になる
  assert.doesNotMatch(body, /set gold = gold \+/, 'Goldを加算している')
  assert.doesNotMatch(body, /max_zako_gold/, '旧Gold上限の計算が残っている')
  // p_gold は互換のため受け取るが、使っていないこと
  assert.match(body, /p_gold bigint/, '引数は互換のため残す')
  assert.doesNotMatch(body, /coalesce\(p_gold/, 'p_gold を読んでいる')
})

test('素材の売値がSQLと material.js で一致している（片方だけ直すと落ちる）', () => {
  // ★売却の権威はサーバー（v2_materials.sell）。表示だけJSにある
  const m = SQL.match(/update public\.v2_materials set sell =[\s\S]*?;/)
  assert.ok(m, 'v2_materials.sell を埋めるUPDATEがSQLにある')
  const sql = m[0]
  // ★売値は**難易度帯**で決まる（同じ帯のエリアはどこの素材でも同じ値段）
  assert.match(sql, /case tier when 1 then/, '売値がエリアIDで引かれている（帯で引くこと）')
  for (const [tier, base] of Object.entries(SELL_BASE_TIER)) {
    assert.match(sql, new RegExp(`when ${tier} then ${base}[^0-9]`), `難易度${tier}の基準額 ${base}`)
  }
  for (const [rarity, mult] of Object.entries(SELL_RARITY_MULT)) {
    assert.match(sql, new RegExp(`when '${rarity}' then ${mult}[^0-9]`), `${rarity} の倍率 ${mult}`)
  }
})

// ===== アリーナ =====
test('負けたときに落ちる階が、SQLと arena.js で一致している', () => {
  // ★2026-08-17の事故：SQLは戦闘力を見ずに必ず1つ落としていたのに、
  //   クライアントの floorAfterLose だけ「戦闘力が足りていれば落ちない」を計算していた。
  //   画面の「次は◯階から」とサーバーの結果がズレる（権威はサーバー）。
  const body = bodyOf('v2_arena_fight')
  assert.match(body, /c_drop\s+constant int := 1;/, '落ちる階数がSQLにある')
  assert.equal(LOSE_DROP, 1, 'JS側の落ちる階数')
  assert.match(body, /v_next := greatest\(1, v_floor - c_drop\)/, '必ず1つ落とす')
  // JS側も戦闘力で結果が変わらないこと（下限が復活したらここで落ちる）
  assert.equal(floorAfterLose(10), 10 - LOSE_DROP)
  assert.equal(floorAfterLose(10, 10 ** 9), 10 - LOSE_DROP, '戦闘力で結果が変わっている')
})

test('v2_sell_materials は検証を全部済ませてから素材を引く（部分的に消えない）', () => {
  const body = bodyOf('v2_sell_materials')
  // ★plpgsql は例外を投げない限りロールバックしない。
  //   「引いてから足りないと気付いて return」だと**引かれたまま**になる
  const checkAt = body.search(/if v_ok <> v_req then/)
  const updateAt = body.search(/update public\.v2_player_materials/)
  assert.notEqual(checkAt, -1, '所持数の検証がある')
  assert.notEqual(updateAt, -1, '素材を引くUPDATEがある')
  assert.ok(checkAt < updateAt, '検証より前に素材を引いている')
  // 金額はサーバーが持つ列から計算する（クライアントの申告を使わない）
  assert.match(body, /sum\(q\.qty \* m\.sell\)/, '売値は v2_materials.sell から計算する')
})

test('v2_daily_claim の目標と報酬が daily.js の LEVELS と一致している', async () => {
  // ★受け取りの判定はサーバーが正。画面の表示（daily.js）とズレると
  //   「達成に見えるのに受け取れない」が起きる
  const { LEVELS } = await import('./daily.js')
  const body = bodyOf('v2_daily_claim')
  for (const lv of LEVELS) {
    for (const [k, n] of Object.entries(lv.goals)) {
      const re = new RegExp(`\\(v_c ->> '${k}'\\)::int, 0\\)\\s*>=\\s*${n}\\b`)
      assert.match(body, re, `${lv.key} の ${k}=${n} がSQLに無い`)
    }
    const re = new RegExp(`v_exp := ${lv.reward.exp};\\s*v_gold := ${lv.reward.gold};`)
    assert.match(body, re, `${lv.key} の報酬 EXP${lv.reward.exp}/${lv.reward.gold}G がSQLに無い`)
  }
})

test('デイリーの内部ヘルパは authenticated から直接叩けない', () => {
  // ⚠SECURITY DEFINER は既定で PUBLIC 実行可。数を好きに増やせてしまうので必ず REVOKE する
  for (const fn of ['v2_daily_roll(uuid)', 'v2_daily_bump(uuid, text, int)']) {
    assert.ok(SQL.includes(`revoke all on function public.${fn} from authenticated;`),
      `${fn} が authenticated から REVOKE されていない`)
    assert.ok(!SQL.includes(`grant execute on function public.${fn} to authenticated;`),
      `${fn} が grant されている`)
  }
})

test('デイリーの数える処理が4か所すべてに入っている', () => {
  // 1つでも抜けるとその項目が永久に達成できない
  assert.match(bodyOf('v2_sortie_settle'), /v2_daily_bump\(v_uid, 'sortie'/, '出撃')
  assert.match(bodyOf('v2_arena_fight'),   /v2_daily_bump\(v_uid, 'arena'/,  'アリーナ')
  assert.match(bodyOf('v2_extract_essence'), /v2_daily_bump\(v_uid, 'rune'/, 'ルーン作成')
  assert.match(bodyOf('v2_pray'),          /v2_daily_bump\(v_uid, 'pray'/,   '祈る')
})

test('出撃のデイリー加算は1回＝1カウント（10秒固定になったので倍率は無い）', () => {
  const body = bodyOf('v2_sortie_settle')
  assert.match(body, /v2_daily_bump\(v_uid, 'sortie', v_n \+ v_bs\)/, '出撃のデイリー加算がある')
  // ★出撃間隔の選択（sortie_cd）ごと廃止したので、列を読む処理が残っていないこと
  assert.doesNotMatch(SQL, /v_row\.sortie_cd/, 'sortie_cd を読む処理が残っている')
  assert.match(SQL, /alter table public\.v2_profiles drop column if exists sortie_cd;/,
    'sortie_cd 列を落とすSQLが無い')
  assert.match(SQL, /drop function if exists public\.v2_set_cooldown\(int\);/,
    'v2_set_cooldown を落とすSQLが無い')
  assert.doesNotMatch(SQL, /create or replace function public\.v2_set_cooldown/,
    'v2_set_cooldown の定義が残っている')
})

// ===== スタミナ（オート出撃の燃料・2026-08-22 ユーザー決定）=====
// ★最大値の伸び方と回復ペースが stamina.js と v2_stamina_max / v2_stamina_roll の
//   2か所にある。ズレると「画面ではオートできるのにサーバーに弾かれる」になる。
test('最大スタミナの計算がSQLと stamina.js で一致している', async () => {
  const { staminaMax, STAMINA_BASE, STAMINA_STEPS } = await import('./stamina.js')
  const body = bodyOf('v2_stamina_max')
  assert.equal(STAMINA_BASE, 10)
  // SQLは段ごとに least(greatest(p_jobs - 開始, 0), 幅) / per を足す形で書いてある。
  // 桁をそろえるスペースは無視して突き合わせる
  const flat = body.replace(/\s+/g, ' ')
  assert.ok(flat.includes('select 10 + least(greatest(coalesce(p_jobs, 0), 0), 29)'),
    '初期値10と「1〜29回は1回ごとに1」がSQLに無い')
  let from = STAMINA_STEPS[0].upto
  for (const s of STAMINA_STEPS.slice(1)) {
    const frag = s.upto === Infinity
      ? `+ greatest(coalesce(p_jobs, 0) - ${from}, 0) / ${s.per}`
      : `+ least(greatest(coalesce(p_jobs, 0) - ${from}, 0), ${s.upto - from}) / ${s.per}`
    assert.ok(flat.includes(frag), `${from + 1}回〜（${s.per}回ごとに1）がSQLに無い： ${frag}`)
    from = s.upto
  }
  // JS側の節目。片方だけ直したらここで気付く
  assert.equal(staminaMax(0), 10)
  assert.equal(staminaMax(29), 39)
  assert.equal(staminaMax(49), 45)
  assert.equal(staminaMax(99), 55)
  assert.equal(staminaMax(299), 75)
})

test('スタミナの回復ペースがSQLと stamina.js で一致している（5分に1）', async () => {
  const { STAMINA_RECOVER_MS } = await import('./stamina.js')
  assert.equal(STAMINA_RECOVER_MS, 5 * 60 * 1000)
  const body = bodyOf('v2_stamina_roll')
  assert.match(body, /c_span constant interval := interval '5 minutes'/, '回復間隔がSQLに無い')
  // ★端数を捨てない（消化したぶんだけ進める）こと。now() で潰すと4分59秒が毎回消える
  assert.match(body, /v_at \+ \(v_gain \* c_span\)/, '端数の繰り越しがSQLに無い')
})

test('オート出撃だけがスタミナを消費する（手動は消費しない）', () => {
  const body = bodyOf('v2_sortie_settle')
  assert.match(body, /p_auto boolean default false/, 'p_auto を受け取っていない')
  assert.match(body, /if coalesce\(p_auto, false\) then/, 'オートのときだけ消費する分岐が無い')
  assert.match(body, /v_stam := public\.v2_stamina_roll\(v_uid\)/, '数え直してから判定していない')
  assert.match(body, /if v_stam < v_cost then/, '足りるかの判定が無い')
  assert.match(body, /stamina = greatest\(0, stamina - v_cost\)/, '消費のUPDATEが無い')
  // ★足りるかの判定は、報酬を書き込むより前で行う
  //   （plpgsql は例外を投げない限りロールバックしない＝配ってから return すると渡したままになる）
  const checkAt = body.search(/if v_stam < v_cost then/)
  const insertAt = body.search(/insert into public\.v2_inventory/)
  assert.notEqual(checkAt, -1, 'スタミナ切れの判定がある')
  assert.notEqual(insertAt, -1, '装備を配るINSERTがある')
  assert.ok(checkAt < insertAt, 'スタミナ切れの判定より前に報酬を配っている')
})

test('スタミナの内部ヘルパは authenticated から直接叩けない', () => {
  // ⚠SECURITY DEFINER は既定で PUBLIC 実行可。好きなだけ回復させられてしまう
  //   （v2_stamina_max は「増え方がマスク」なので、そもそも読ませない）
  for (const fn of ['v2_stamina_max(int)', 'v2_stamina_roll(uuid)']) {
    assert.ok(SQL.includes(`revoke all on function public.${fn} from authenticated;`),
      `${fn} が authenticated から REVOKE されていない`)
    assert.ok(!SQL.includes(`grant execute on function public.${fn} to authenticated;`),
      `${fn} が grant されている`)
  }
})

// ===== 武器の進化（戦闘記憶）=====
// ★能力の名簿は evolveTraits.js と v2_evolve_traits の2か所にある。値はサーバーが
//   名簿の倍率から計算し直すので、ズレると**画面と実際の効果が食い違う**。
test('能力の名簿がSQLと evolveTraits.js で完全に一致している', async () => {
  const { TRAITS } = await import('./evolveTraits.js')
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_evolve_traits'))
  const rows = [...seed.slice(0, seed.indexOf(';')).matchAll(/\n\s*\('([^']+)','([^']+)','([^']+)','(\[.*?\])'\)/g)]
  assert.equal(rows.length, TRAITS.length, `名簿の行数が違う（SQL ${rows.length} / JS ${TRAITS.length}）`)
  const bySql = new Map(rows.map(m => [m[1], { axis: m[2], name: m[3], atoms: JSON.parse(m[4]) }]))
  for (const t of TRAITS) {
    const row = bySql.get(t.key)
    assert.ok(row, `${t.key} がSQLに無い`)
    assert.equal(row.axis, t.axis, `${t.key} の軸`)
    assert.equal(row.name, t.name, `${t.key} の名前`)
    const want = [
      ...t.gain.map(([a, w]) => ({ a, w, c: false })),
      ...t.cost.map(([a, w]) => ({ a, w, c: true })),
    ]
    assert.deepEqual(row.atoms, want, `${t.key} の部品`)
  }
})

test('覚醒するレベル・予算・1レベルの経験値が evolve.js とSQLで一致している', async () => {
  const { LEVELS, STAGE_CAP, FOES_KEEP, EXP_PER_LEVEL } = await import('./evolve.js')
  const ev = bodyOf('v2_weapon_evolve')
  assert.ok(ev.includes(`array[${LEVELS.join(', ')}]`), `覚醒レベル ${LEVELS} がSQLと違う`)
  assert.ok(ev.includes(`array[${STAGE_CAP.join(', ')}]`), `予算 ${STAGE_CAP} がSQLと違う`)
  assert.ok(ev.includes(`c_per_lv constant int       := ${EXP_PER_LEVEL};`), '1レベルの経験値がSQLと違う')
  const rec = bodyOf('v2_weapon_record')
  assert.ok(rec.includes(`c_foes_keep constant int := ${FOES_KEEP};`), '敵の記録の上限がSQLと違う')
  assert.ok(rec.includes(`array[${LEVELS.join(', ')}]`), '覚醒レベルがSQLと違う')
  assert.ok(rec.includes(`c_per_lv    constant int := ${EXP_PER_LEVEL};`), '1レベルの経験値がSQLと違う')
})

// ★戦績のキーを増やしたのにSQLの上限表へ入れ忘れると、その項目だけ永遠に0のままになる
test('戦績のキーがSQLの上限表にぜんぶ入っている（数え忘れを検出）', async () => {
  const { emptyRecord } = await import('./evolve.js')
  const body = bodyOf('v2_weapon_record')
  const missing = Object.keys(emptyRecord())
    .filter(k => k !== 'foes')
    .filter(k => !body.includes(`'${k}',`))
  assert.deepEqual(missing, [], `v2_weapon_record が積んでいない項目: ${missing.join(', ')}`)
})

test('v2_weapon_record は1戦ぶんの申告を頭打ちにする（言い値で積ませない）', () => {
  const body = bodyOf('v2_weapon_record')
  const has = (t, msg) => assert.ok(body.includes(t), msg)
  has("'battles',    1", '1戦は必ず1と数える')
  has("(p_rec ->> 'exp')::int, 0), 0), c_max_exp)", '経験値に上限が無い')
  // クリはヒット数まで、回避は被弾数まで…と、上限になる値まで含めて固定する
  for (const [k, cap] of [['crit', 'v_hits'], ['physHits', 'v_hits'], ['magHits', 'v_hits'],
                          ['skillHits', 'v_hits'], ['normalHits', 'v_hits'], ['multiHits', 'v_hits'],
                          ['drains', 'v_hits'], ['ail', 'v_hits'], ['dodged', 'v_taken'],
                          ['lowWin', 'v_wins'], ['bigWin', 'v_wins'], ['bossWin', 'v_wins'],
                          ['fastWin', 'v_wins'], ['longWin', 'v_wins'], ['perfect', 'v_wins'],
                          ['comeback', 'v_wins'], ['overkill', 'v_wins']]) {
    has(`(p_rec ->> '${k}')::int, 0), 0), ${cap})`, `${k} を ${cap} で頭打ちにしていない`)
  }
  has("'wins')::int, 0), 0), 1)", '勝ちは1戦につき1まで')
  has("'firsts')::int, 0), 0), 1)", '先攻は1戦につき1まで')
  has("'turns')::int, 0), 0), c_max_turns)", 'ターン数に上限が無い')
  has("'hurtPct')::numeric, 0), 0), 1)", '失ったHPの割合が0〜1に収まっていない')
  // 部位が武器のものだけに積む（防具に熟練度が乗らない）
  has("e.part = '武器'", '武器以外にも積んでいる')
  // ★読んで足して書くので、行をロックしないと同時呼び出しで増分が消える
  //   （2026-08-21 実機テストで実測：100回呼んで37回しか積まれなかった）
  has('for update of i', 'ロックせずに読んでいる（同時に呼ばれると熟練度が消える）')
})

// ★ここがこの機能のいちばん大事な守り。値をクライアントから受け取ると好きなだけ盛れる
test('v2_weapon_evolve は効果の値をサーバーで作り直す（言い値を使わない）', () => {
  const body = bodyOf('v2_weapon_evolve')
  const has = (t, msg) => assert.ok(body.includes(t), msg)
  assert.doesNotMatch(body, /p_eff|p_value/, '効果の値を引数で受け取っている')
  has('from public.v2_evolve_traits t where t.key = p_key', '名簿を引いていない')
  has("v_cap * v_s * (e ->> 'w')::numeric", '名簿の倍率から値を作っていない')
  has('least(greatest(coalesce(p_s, 0), 0), 1)', '偏りの強さを0〜1に収めていない')
  has('v_stage := jsonb_array_length(v_evos) + 1', '段階は付いている数から決める')
  has('v_lv < c_levels[v_stage]', '熟練度のレベルが足りているか見ていない')
  has("(v_row.record, '{}'::jsonb) ->> 'exp')::int, 0) / c_per_lv", 'レベルを経験値から出していない')
  has("e ->> 'key' = p_key", '同じ能力の重複を見ていない')
  has("e.part = '武器'", '武器以外にも進化が付けられる')
  // ★宿敵狩り（倒した相手の名前で決まる能力）は廃止した。引数ごと残っていないか見る
  assert.doesNotMatch(body, /p_foe/, '宿敵狩りの引数が残っている')
})

// ★スキル・職業補正・装備の特殊能力と同じで、**戦闘のある画面すべて**に入っていないと
//   その画面だけ熟練度が貯まらない（どちらで戦ったかで差が出る）
test('runBattle を呼ぶ画面は必ず戦績も積んでいる', () => {
  const dir = new URL('../components/', import.meta.url)
  const seen = []
  const bad = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsx')) continue
    const src = readFileSync(new URL(name, dir), 'utf8')
    if (!src.includes('runBattle(')) continue
    seen.push(name)
    if (!src.includes('pushWeaponRecord(')) bad.push(name)
  }
  assert.ok(seen.length >= 2, `戦闘のある画面を拾えている（${seen.join(', ')}）`)
  assert.deepEqual(bad, [], `戦績を積んでいない戦闘画面: ${bad.join(', ')}`)
})

// ===== エリアと難易度帯 =====
// ★2026-08-22 ユーザー決定：帯を全部踏破すると次の帯が開く。
//   エリア・素材の名簿はJSとSQLの2か所にあるので、**片方だけ足したらここで落とす**
test('v2_areas が enemies.js のエリアと完全に一致している（id・帯・名前・ドロップ表）', async () => {
  const { AREAS } = await import('./enemies.js')
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_areas ('))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(
    /\((\d+), (\d+), '([^']+)', '(\{[^']+\})'::jsonb/g)]
  assert.equal(rows.length, AREAS.length, 'v2_areas の行数がJS側と違う')
  const bySql = new Map(rows.map(m => [Number(m[1]), { tier: Number(m[2]), name: m[3], ranks: JSON.parse(m[4]) }]))
  for (const a of AREAS) {
    const row = bySql.get(a.id)
    assert.ok(row, `エリア${a.id} が v2_areas に無い`)
    assert.equal(row.tier, a.tier, `エリア${a.id}の帯`)
    assert.equal(row.name, a.name, `エリア${a.id}の名前`)
    assert.deepEqual(row.ranks, a.dropRanks, `エリア${a.id}のドロップ表`)
  }
})

test('v2_tiers の必要踏破数が sortie.js の TIER_REQ と一致している', async () => {
  const { TIER_REQ } = await import('./sortie.js')
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_tiers (tier, req) values'))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(/\((\d+),(\d+)\)/g)]
  assert.equal(rows.length, Object.keys(TIER_REQ).length, 'v2_tiers の行数がJS側と違う')
  for (const [, tier, req] of rows) assert.equal(Number(req), TIER_REQ[Number(tier)], `難易度${tier}の必要数`)
})

test('v2_materials が material.js の素材と完全に一致している（帯とレンジも）', async () => {
  const { MATERIALS } = await import('./material.js')
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_materials ('))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(
    /\('([^']+)', '([^']+)', '([^']+)', (\d+), (\d+), '(\w+)', (true|false), array\[([^\]]+)\], ([\d.]+), ([\d.]+)\)/g)]
  assert.equal(rows.length, MATERIALS.length, 'v2_materials の行数がJS側と違う')
  const bySql = new Map(rows.map(m => [m[1], {
    name: m[2], enemy: m[3], area: Number(m[4]), tier: Number(m[5]), rarity: m[6],
    isBoss: m[7] === 'true', stats: m[8].split(',').map(x => x.replace(/'/g, '')),
    lo: Number(m[9]), hi: Number(m[10]),
  }]))
  for (const m of MATERIALS) {
    const row = bySql.get(m.id)
    assert.ok(row, `${m.id} が v2_materials に無い`)
    assert.equal(row.name, m.name, `${m.id}の名前`)
    assert.equal(row.enemy, m.enemy, `${m.id}の敵`)
    assert.equal(row.area, m.area, `${m.id}のエリア`)
    assert.equal(row.tier, m.tier, `${m.id}の帯`)
    assert.equal(row.isBoss, m.isBoss, `${m.id}のボス判定`)
    assert.deepEqual(row.stats, m.stats, `${m.id}のステータス`)
    assert.deepEqual([row.lo, row.hi], [m.lo, m.hi], `${m.id}のレンジ`)
  }
})

test('v2_sortie_settle の解放は「帯を全部踏破したら次」になっている', () => {
  const body = bodyOf('v2_sortie_settle')
  // ★1本道だった頃の「倒したエリア+1を開ける」が残っていると、④で1つ倒しただけで⑤へ行けてしまう
  assert.doesNotMatch(body, /array_append\(v_unlocked, p_area \+ 1\)/, '1本道の解放が残っている')
  assert.match(body, /v2_unlocked_from_cleared\(v_cleared, v_row\.unlocked_areas\)/,
    '帯の規則で解放し直していない')
  // 踏破は積んでいること（帯の判定はこれを数える）
  assert.match(body, /array_append\(v_cleared, p_area\)/, '踏破を積んでいない')
})

test('解放を作り直す内部ヘルパは authenticated から直接叩けない', () => {
  // ⚠v2sql の「grant したRPCは is_admin を見ること」の裏返し。内部ヘルパは grant しない
  assert.ok(!SQL.includes('grant execute on function public.v2_unlocked_from_cleared'),
    'v2_unlocked_from_cleared が grant されている')
  assert.ok(SQL.includes('revoke all on function public.v2_unlocked_from_cleared(int[], int[]) from authenticated;'),
    'v2_unlocked_from_cleared が REVOKE されていない')
})

// ★このファイルは「全文を何度も流し直す」運用（v2の鉄則）。
//   種（マスタ）の insert が入れ直せない形になっていると、**2回目に流したときだけ**落ちる。
//   実際 v2_skills が on conflict も delete も無い形になっていて、
//   「duplicate key value violates unique constraint "v2_skills_pkey"」で止まった（2026-08-23）。
//   目視では気づけないので、全部の種を機械的に洗う。
test('★マスタの種は何度流しても入れ直せる（2回目に落ちる insert を作らない）', () => {
  const lines = SQL.split('\n')
  const stmts = []
  let cur = null
  lines.forEach((l, i) => {
    if (/^\s*insert into public\.(v2_\w+)/.test(l)) {
      if (cur) stmts.push(cur)
      cur = { table: l.match(/insert into public\.(v2_\w+)/)[1], line: i + 1, text: l, inFunc: /^\s+insert/.test(l) }
    } else if (cur) {
      cur.text += '\n' + l
      if (/;\s*$/.test(l)) { stmts.push(cur); cur = null }
    }
  })
  if (cur) stmts.push(cur)
  assert.ok(stmts.length >= 10, `insert を拾えている（${stmts.length}件）`)

  const bad = stmts.filter(s => {
    if (s.inFunc) return false                       // 関数の中は毎回走る前提なので対象外
    if (/on conflict/.test(s.text)) return false     // 入れ直せる
    // 直前に同じ表を空にしていれば入れ直せる
    const before = SQL.slice(0, SQL.indexOf(s.text))
    return !new RegExp(`delete from public\\.${s.table}\\s*;`).test(before.slice(-500))
  }).map(s => `${s.table}（${s.line}行目）`)

  assert.deepEqual(bad, [],
    `2回目に流すと落ちる種がある。on conflict を付けるか、直前で delete すること: ${bad.join(' / ')}`)
})

// ★宝樹の報酬は「配るのはサーバー・表示はJS」の2か所に同じ数字がある（2026-08-23）
//   片方だけ直すと、画面に出る額と実際にもらえる額が食い違う
test('宝樹の報酬（ベースと倍率）がSQLとJSで一致している', () => {
  const gold = SQL.match(/c_gold\s+constant int\s+:=\s*(\d+)/)
  const exp = SQL.match(/c_exp\s+constant int\s+:=\s*(\d+)/)
  const mult = SQL.match(/c_mult\s+constant numeric\[\]\s*:=\s*array\[([^\]]+)\]/)
  assert.ok(gold && exp && mult, 'v2_pray に報酬の定義が見つからない')
  assert.equal(Number(gold[1]), PRAY_GOLD, 'ベースGoldが違う')
  assert.equal(Number(exp[1]), PRAY_EXP, 'ベースEXPが違う')
  assert.deepEqual(
    mult[1].split(',').map(s => Number(s.trim())),
    FORTUNES.map(f => f.mult),
    '結果ごとの倍率が違う（並びはSQLの c_names と同じ順）')
})

// ★v2_enemies は「討伐の申告を弾く」ための名簿。ズレると正しい討伐が数えられない。
//   （enemies.js が正・SQLはその写し。2026-08-26 モンスター図鑑）
test('v2_enemies が enemies.js の敵と完全に一致している', async () => {
  const { AREAS_SORTED } = await import('./enemies.js')
  const want = new Map()
  for (const a of AREAS_SORTED) {
    const put = (e, slot) => want.set(e.name, { area:a.id, tier:a.tier, slot, band:e.band || null, kind:e.kind, power:e.power })
    for (const e of a.enemies) put(e, 'normal')
    for (const e of a.timed) put(e, 'timed')
    for (const e of a.rares) put(e, 'rare')
    put(a.boss, 'boss')
  }
  const seed = SQL.slice(SQL.indexOf('insert into public.v2_enemies (name, area, tier, slot, band, kind, power) values'))
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(
    /\('([^']+)', (\d+), (\d+), '(\w+)', (?:'([^']+)'|null), '(\w+)', (\d+)\)/g)]
  assert.equal(rows.length, want.size, 'v2_enemies の行数がJS側と違う')
  for (const m of rows) {
    const w = want.get(m[1])
    assert.ok(w, `SQLにあってJSに無い敵: ${m[1]}`)
    assert.equal(Number(m[2]), w.area, `${m[1]} のエリア`)
    assert.equal(Number(m[3]), w.tier, `${m[1]} の帯`)
    assert.equal(m[4], w.slot, `${m[1]} の枠`)
    assert.equal(m[5] ?? null, w.band, `${m[1]} の時間帯`)
    assert.equal(m[6], w.kind, `${m[1]} の型`)
    assert.equal(Number(m[7]), w.power, `${m[1]} の戦闘力`)
  }
})

// ★討伐数はサーバーが数える。**自分で書ける穴が開いていないこと**
test('★討伐数と図鑑の素材は自分で書き換えられない（読むだけ）', () => {
  for (const t of ['v2_kills', 'v2_dex_materials']) {
    assert.ok(SQL.includes(`grant select on table public.${t} to authenticated;`), `${t} に select の許可が無い`)
    for (const bad of ['insert', 'update', 'delete']) {
      assert.ok(!SQL.includes(`grant ${bad} on table public.${t} to authenticated`), `${t} に ${bad} を許してしまっている`)
    }
    assert.ok(SQL.includes(`alter table public.${t} enable row level security;`), `${t} のRLSが無い`)
  }
  // 討伐数を積むのは出撃の清算だけ
  const bumps = [...SQL.matchAll(/insert into public\.v2_kills/g)]
  assert.equal(bumps.length, 1, '討伐数を書く場所が2か所以上ある')
})

// ★勝った敵の名前をサーバーへ送っていること（送り忘れると図鑑が一生埋まらない）
test('★出撃は戦った敵の名前と勝敗をサーバーへ送っている', () => {
  const src = readFileSync(new URL('../components/V2Sortie.jsx', import.meta.url), 'utf8')
  assert.match(src, /p_enemy: enc\.enemy\.name/, '敵の名前を送っていない')
  assert.match(src, /p_win: win/, '勝敗を送っていない')
  assert.ok(SQL.includes('p_enemy text default null'), 'サーバーが p_enemy を受け取っていない')
  assert.ok(SQL.includes('p_win boolean default false'), 'サーバーが p_win を受け取っていない')
})

// ★このファイルは何度でも流し直す運用。**「一度だけ」の処理が繰り返されないこと**を縛る。
//   図鑑の素材の拾い直しが毎回走ると、リセットしても流し直した瞬間に戻ってしまう（実際に困った）
test('★一度だけの処理は v2_migrations で守られている', () => {
  assert.ok(SQL.includes('create table if not exists public.v2_migrations'), 'v2_migrations が無い')
  // ⚠SQLファイルの改行はCRLF。行をまたぐところは正規表現で拾う
  const backfill = /insert into public\.v2_dex_materials \(player_id, material_id\)\s+select player_id, material_id from public\.v2_player_materials/
  const hit = SQL.match(backfill)
  assert.ok(hit, '素材の拾い直しが見つからない')
  // 拾い直しの前に「まだやっていないか」の判定があること
  const before = SQL.slice(Math.max(0, hit.index - 400), hit.index)
  assert.match(before, /v2_migrations where key = 'dex_material_backfill'/, '拾い直しが毎回走ってしまう')
  assert.ok(SQL.includes("insert into public.v2_migrations (key) values ('dex_material_backfill')"), '目印を残していない')
})
// ★関数の引数を増やしたら、**grant / revoke の引数も直す**必要がある。
//   REVOKE は関数が無いと「does not exist」で**その場で全文が止まる**（2026-08-26 実際に踏んだ）。
//   DROP は if exists で黙るので気付けない。ここで機械的に突き合わせる。
test('★grant / revoke の関数の引数が、作った関数と一致している', () => {
  // 「create or replace function public.名前(引数)」から引数の型だけ取り出す
  const defined = new Map()   // 名前 -> Set(引数の型を並べた文字列)
  const CREATE = /create or replace function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/g
  for (const m of SQL.matchAll(CREATE)) {
    const types = m[2].split(',').map(a => {
      // 「p_name type default ...」から type だけ。default の中のカンマは無い前提（実際に無い）
      const t = a.trim().replace(/\s+default[\s\S]*$/i, '').split(/\s+/)
      return (t[1] || '').toLowerCase()
    }).filter(Boolean).join(', ')
    if (!defined.has(m[1])) defined.set(m[1], new Set())
    defined.get(m[1]).add(types)
  }
  assert.ok(defined.size > 20, `関数が ${defined.size} 個しか読めていない（読み取りが壊れている）`)

  const bad = []
  const USE = /(?:revoke [\w ]+|grant execute) on function public\.(\w+)\(([^)]*)\)/g
  for (const m of SQL.matchAll(USE)) {
    const name = m[1]
    const sig = m[2].split(',').map(x => x.trim().toLowerCase()).filter(Boolean).join(', ')
    const have = defined.get(name)
    if (!have) { bad.push(`${name} … この名前の関数を作っていない`); continue }
    if (!have.has(sig)) bad.push(`${name}(${sig}) … 作ったのは (${[...have].join(') / (')})`)
  }
  assert.deepEqual(bad, [], `grant/revoke の引数がズレている: ${bad.join(' ／ ')}`)
})
