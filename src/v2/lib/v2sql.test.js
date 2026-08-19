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
import { SELL_BASE, SELL_RARITY_MULT } from './material.js'
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
  const rows = [...seed.slice(0, seed.indexOf('on conflict')).matchAll(/\('([^']+)','([^']+)',(\d+),(\d+)\)/g)]
  assert.equal(rows.length, SKILLS.length, 'v2_skills の行数がJS側と違う')
  const bySql = new Map(rows.map(m => [m[1], { cls: m[2], mp: Number(m[3]) }]))
  for (const s of SKILLS) {
    const row = bySql.get(s.name)
    assert.ok(row, `${s.name} が v2_skills に無い`)
    assert.equal(row.cls, s.cls, `${s.name} の職業`)
    assert.equal(row.mp, s.mp || 0, `${s.name} の消費MP`)
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
  const granted = [...SQL.matchAll(/grant execute on function public\.(v2_\w+)\(/g)].map(m => m[1])
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
  for (const [area, base] of Object.entries(SELL_BASE)) {
    assert.match(sql, new RegExp(`when ${area} then ${base}[^0-9]`), `エリア${area}の基準額 ${base}`)
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

test('出撃のデイリー加算がクールタイム別になっている（20秒は2カウント）', async () => {
  // ★片方だけ直すと「画面には20秒は2カウントと書いてあるのに1しか増えない」になる
  const { SORTIE_COUNT } = await import('./daily.js')
  assert.equal(SORTIE_COUNT[20], 2)
  const body = bodyOf('v2_sortie_settle')
  assert.match(body, /v2_daily_bump\(v_uid, 'sortie'/, '出撃のデイリー加算がある')
  assert.match(body, /case when v_row\.sortie_cd = 20 then 2 else 1 end/,
    '20秒を2倍にする分岐がSQLに無い')
})

// ===== 武器の進化（戦闘記憶）=====
// ★節目と上限は evolve.js と v2_weapon_evolve の2か所にある。片方だけ直すと
//   「画面には進化できると出るのにサーバーに弾かれる」または「上限を超えた値が通る」になる
test('武器の進化の節目・上限・能力のキーが evolve.js とSQLで一致している', async () => {
  const { STAGES, STAGE_CAP, TRAITS, FOES_KEEP } = await import('./evolve.js')
  const body = bodyOf('v2_weapon_evolve')
  assert.ok(body.includes(`array[${STAGES.join(', ')}]`), `節目 ${STAGES} がSQLと違う`)
  assert.ok(body.includes(`array[${STAGE_CAP.join(', ')}]`), `上限 ${STAGE_CAP} がSQLと違う`)
  const keys = TRAITS.map(t => `'${t.key}'`).join(',')
  assert.ok(body.includes(`array[${keys}]`), `能力のキーがSQLと違う（${keys}）`)
  // 戦績を積む側の上限も合わせる
  const rec = bodyOf('v2_weapon_record')
  assert.ok(rec.includes(`c_foes_keep constant int := ${FOES_KEEP};`), '敵の記録の上限がSQLと違う')
  assert.ok(rec.includes(`array[${STAGES.join(', ')}];`), '節目がSQLと違う')
})

test('v2_weapon_record は1戦ぶんの申告を頭打ちにする（言い値で積ませない）', () => {
  const body = bodyOf('v2_weapon_record')
  // 戦闘はクライアントが回すので、素直に足すと熟練度も戦績もいくらでも盛れる
  const has = (t, msg) => assert.ok(body.includes(t), msg)
  has("'battles', 1", '1戦は必ず1と数える')
  // クリはヒット数、回避は被弾数…と、上限になる値まで含めて固定する
  for (const [k, cap] of [['crit', 'v_hits'], ['dodged', 'v_taken'], ['ail', 'v_hits'],
                          ['lowWin', 'v_wins'], ['bigWin', 'v_wins']]) {
    has(`'${k}'`, `${k} を積んでいない`)
    has(`::int, 0), 0), ${cap})`, `${k} を ${cap} で頭打ちにしていない`)
  }
  has("'wins')::int, 0), 0), 1)", '勝ちは1戦につき1まで')
  has("'turns')::int, 0), 0), c_max_turns)", 'ターン数に上限が無い')
  // 部位が武器のものだけに積む（防具に熟練度が乗らない）
  has("e.part = '武器'", '武器以外にも積んでいる')
})

test('v2_weapon_evolve は段階・熟練度・重複・相手を検証する', () => {
  const body = bodyOf('v2_weapon_evolve')
  const has = (t, msg) => assert.ok(body.includes(t), msg)
  has('v_stage := jsonb_array_length(v_evos) + 1', '段階は付いている数から決める')
  has('if v_bat < c_stages[v_stage]', '熟練度が足りているか見ていない')
  has("e ->> 'key' = p_key", '同じ能力の重複を見ていない')
  has("-> 'foes' ? p_foe", '宿敵狩りの相手を戦績で確かめていない')
  has('least(greatest(coalesce(p_value, 0), 1), c_caps[v_stage])', '値を上限で切っていない')
  has("e.part = '武器'", '武器以外にも進化が付けられる')
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
