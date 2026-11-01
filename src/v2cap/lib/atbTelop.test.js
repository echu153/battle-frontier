// v2cap の ATB戦闘のテロップ（戦闘開始・討伐完了）と報酬画面の決まりのテスト（node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { START_TELOP_MS, CLEAR_TELOP_MS, FAIL_TELOP_MS, LOSE_DELAY_MS, TIMEUP_DELAY_MS, NO_DEATH_DELAY_MS, startTelopOn, startTelopShown, clearTelopDelayOf, endTelopOf } from './atbTelop.js'
import { lastHitAtOf } from './atbFx.js'
import { bossIllustOf } from './bossIllust.js'
import { deathLandMs } from './bossDeath.js'
import { DUNGEON_BOSSES, DUNGEON_TRY_SEC, contributionPctOf } from './dungeon.js'
import { ENCOUNTER_WAIT_MAX_MS } from './useBossEncounter.js'
import { bossEncounterOf } from './bossArt.js'

const read = (f) => readFileSync(new URL(`../components/${f}`, import.meta.url), 'utf8')

test('戦闘開始のテロップのあいだは時計を止める（絵を読んでいるあいだも）', () => {
  assert.equal(startTelopOn(null, 5000), true)
  assert.equal(startTelopOn(1000, 1000), true)
  assert.equal(startTelopOn(1000, 1000 + START_TELOP_MS - 1), true)
  assert.equal(startTelopOn(1000, 1000 + START_TELOP_MS), false)
  // 戦闘の画面は、止まっているあいだ advance を呼ばない
  const src = read('V2capAtbFight.jsx')
  assert.match(src, /if \(s && !s\.over && !startTelopOn\(introT0\.current, now, introMs\)\) \{\s+advance\(/)
})

test('討伐完了はボスが倒れて体がほとんど消えたころに出る（どのボスも）', () => {
  for (const key of Object.keys(DUNGEON_BOSSES)) {
    const art = bossIllustOf(key)
    assert.ok(art?.death, `${key} に倒れる動きがある`)
    const at = clearTelopDelayOf(art)
    assert.ok(at > deathLandMs(art.death), `${key} 倒れきってから`)
    assert.ok(at > art.death.burnAt, `${key} 消え始めてから`)
    assert.ok(at < art.death.burnAt + art.death.burnMs, `${key} 消えきる前から`)
  }
  assert.equal(clearTelopDelayOf(null), NO_DEATH_DELAY_MS)   // 図鑑の絵の敵（試し撃ち）
  assert.ok(CLEAR_TELOP_MS > 1000, '読める長さ')
})

test('止めの一撃の時刻：その側の最後のダメージの数字（まだ先のものも入れる）', () => {
  const fx = [
    { side:'b', kind:'hit', t0: 11 },
    { side:'b', kind:'tick', t0: 12.5 },
    { side:'a', kind:'hit', t0: 20 },
    { side:'b', kind:'act', t0: 30 },
  ]
  assert.equal(lastHitAtOf(fx, 'b', 10), 12.5)
  assert.equal(lastHitAtOf(fx, 'b', 13), 13)
  assert.equal(lastHitAtOf([], 'b', 7), 7)
})

test('決着のテロップ（ユーザー「プレイヤーが敗北したときのテロップも欲しい」）：ボスが倒れたら討伐完了・自分が倒れたら敗北・どちらも立っていれば時間切れ', () => {
  const art = bossIllustOf('varuzenoku')
  const fx = [{ side:'b', kind:'hit', t0: 10.2 }, { side:'a', kind:'hit', t0: 10.4 }]
  const clear = endTelopOf({ b: { hp: 0 }, winner:'a' }, fx, 10000, art)
  assert.deepEqual(clear, { kind:'clear', ms: CLEAR_TELOP_MS, at: 10200 + clearTelopDelayOf(art) })
  assert.equal(endTelopOf({ b: { hp: 0 }, winner:'draw' }, fx, 10000, art).kind, 'clear', '相打ちもボスが倒れていれば討伐完了')
  assert.deepEqual(endTelopOf({ b: { hp: 50 }, winner:'b' }, fx, 10000, art), { kind:'lose', ms: FAIL_TELOP_MS, at: 10400 + LOSE_DELAY_MS })
  assert.deepEqual(endTelopOf({ b: { hp: 50 }, winner:'draw' }, [], 10000, art), { kind:'timeup', ms: FAIL_TELOP_MS, at: 10000 + TIMEUP_DELAY_MS })
  const look = read('V2capAtbTelop.jsx')
  for (const w of ['戦闘開始', '討伐完了', '敗北', '時間切れ']) assert.ok(look.includes(`word: '${w}'`), w)
})

test('貢献度：与えたダメージがボスの全体のHPの何割か・1人ぶんは100%まで（ユーザー「貢献度もわかるようにしてほしい、ダメージ与えた割合ね」）', () => {
  assert.equal(contributionPctOf(3250, 6500), 50)
  assert.equal(contributionPctOf(0, 6500), 0)
  assert.equal(contributionPctOf(9000, 6500), 100)
  assert.match(read('V2capBossReward.jsx'), /members\.length > 0 &&/, '1人でも出す')
  assert.match(read('V2capDungeon.jsx'), /貢献度\{contributionPctOf\(m\.damage, run\.hp_max\)\.toFixed\(1\)\}%/, '入っているボスの行にも出す')
})

test('結果の画面：討伐も負けも時間切れもテロップのあと・やめた所でもう倒されていたらすぐ・もう一度挑戦できるのは倒せなかったときだけ', () => {
  const src = read('V2capDungeon.jsx')
  assert.match(src, /onOver=\{onOver\} onEnded=\{onEnded\}/)
  assert.match(src, /if \(shown\.ended \|\| \(!shown\.st\.over && r\?\.ok && r\.run\.cleared\)\) \{/)
  assert.match(src, /const canRetry = r\?\.ok && !r\.run\.cleared && msLeftOf\(r\.run\.ends_at, nowMs\) > 0/)
  // 決着のあとは下のボタンを出さない（テロップのあとの画面で選ぶ）
  assert.match(src, /footer=\{earlyFight \|\| shown\.st\.over \? null/)
  // 報酬画面の「入口へ戻る」は結果が届くまで押せない・画面を切り替えたら上へ
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /<button onClick=\{onBack\} disabled=\{!r\}/)
  assert.match(reward, /text:'敗北'/)
  assert.match(reward, /text:'時間切れ'/)
  assert.match(reward, /ボスの残りHP/)
  assert.match(reward, /もう一度挑戦する（スタミナ\{retryCost\}）/)
  assert.match(reward, /useEffect\(\(\) => \{ window\.scrollTo\(0, 0\) \}, \[\]\)/)
})

test('報酬画面の報酬の欄：EXP は実際に入った量・LVアップの行・SQL を流す前は準備中・渡せるものが無ければ無し', () => {
  const reward = read('V2capBossReward.jsx')
  assert.match(reward, /EXP \+\{gainedExpOf\(reward\)\.toLocaleString\(\)\}/)
  assert.match(reward, /Gold \+\{Number\(reward\.gold\)\.toLocaleString\(\)\}/)
  assert.match(reward, /levelUpLines\(cls, reward\.level\)/)
  assert.match(reward, /reward === undefined && .*報酬は準備中です/)
  // ソロの行に倍率を書かない（ユーザー「これ完全ソロ討伐成功！にして、報酬3倍とか具体的な内容は言わないでほしい」）
  assert.match(reward, /reward\.solo && .*>完全ソロ討伐成功！<\/div>/)
  const code = reward.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n')   // コメントの外
  assert.doesNotMatch(code, /SOLO_REWARD_MULT|報酬3倍/)
  assert.match(reward, /reward === null && .*この討伐の報酬はありません/)
})

test('その場にいなかった人は入口で受け取る：受け取りのあと同じ報酬画面へ・やめた所でもう倒されていたら報酬画面へ', () => {
  const src = read('V2capDungeon.jsx')
  assert.match(src, /\(state\?\.rewards \|\| \[\]\)\.map\(run =>/)
  assert.match(src, /call\('v2cap_dungeon_claim', \{ p_run: run\.id \}, \(data\) => \{ setClaimed\(data\); onProfile\?\.\(\); load\(\) \}\)/)
  assert.match(src, /if \(claimed\) \{\s+return <V2capBossReward /)
  assert.match(src, /if \(r\?\.ok && r\.run\.cleared\) \{ setFight\(f => \(f \? \{ \.\.\.f, result: r \} : f\)\); if \(r\.reward\) onProfile\?\.\(\); return \}/)
  assert.match(src, /if \(r\?\.reward\) onProfile\?\.\(\)/, 'EXP と Gold が増えたらホームの数字も直す')
})

test('挑戦を押した瞬間に遭遇のイラスト（ユーザー「挑戦を押してから若干ラグがあって」「挑戦したら遭遇のイラストがどん！って出るように」）：サーバーの返事を待たない・出ているあいだ戦闘は始まらない', () => {
  const src = read('V2capDungeon.jsx').replace(/\r\n/g, '\n')
  // サーバーを呼ぶ前に出す（どの入り方も）
  assert.match(src, /const challenge = async \(bossKey, diff\) => \{\n\s*showEncounter\(bossKey, diff\)\n\s*const data = await call\('v2cap_dungeon_summon'/)
  assert.match(src, /const enter = async \(run\) => \{\n\s*showEncounter\(run\.boss, run\.diff, run\.hp\)\n\s*if \(await start\(run\)\) enc\.finish\(\)\n\s*else enc\.cancel\(\)/)
  assert.match(src, /const retry = async \(\) => \{\n\s*showEncounter\(fight\.run\.boss, fight\.run\.diff, fight\.result\?\.run\?\.hp\)/)
  assert.match(src, /onClick=\{\(\) => enter\(run\)\}/, '入っているボスの「挑戦する」も同じ')
  assert.match(src, /if \(!data\) \{ enc\.cancel\(\); return \}/, '始められなければ入口へ（わけは入口に出る）')
  assert.match(src, /hold=\{enc\.hold\}/)
  // 押したら絵を待たない（ユーザー「遭遇イラスト出たときはタップしたら戦闘画面に遷移できるようにして」）
  const hook = readFileSync(new URL('./useBossEncounter.js', import.meta.url), 'utf8')
  assert.match(hook, /Promise\.race\(\[tapped, tooLong\]\)/)
  assert.match(src, /onTap=\{enc\.skip\}/)
  // 版の確かめはボスを開いたときに済ませる（押してから聞かない）
  assert.match(src, /if \(await staleNow\(\)\)/)
  // 出ているあいだは戦闘の時計も戦闘開始のテロップも始めない
  assert.match(read('V2capAtbFight.jsx'), /if \(paused \|\| !artReady \|\| hold\) return/)
  // 戦闘に要る絵は押す前に裏で読んでおく（押したらすぐ戦闘の絵が出る）
  assert.match(hook, /preloadArt\(srcs\)/)
  assert.match(src, /enc\.begin\(bossKey, diffKey, \[\.\.\.\(artOfBoss\(bossKey\)\?\.srcs \|\| \[\]\), bossEncounterOf\(bossKey\), playerSrc, motionSrc\]/)
  for (const key of Object.keys(DUNGEON_BOSSES)) assert.ok(bossEncounterOf(key), `${key} に遭遇の大きな絵がある`)
  assert.ok(!/background-clip|backgroundClip/i.test(read('V2capBossEncounter.jsx')))
})

test('【確定】2026-11-01 遭遇のイラストを押したら、サーバーの返事を待たずに戦闘の画面へ（ユーザー「遭遇時にタップ押したら画面遷移ができてない」＝前は返事が届くまで絵が消えなかった）', () => {
  const hook = readFileSync(new URL('./useBossEncounter.js', import.meta.url), 'utf8')
  // 返事の前に押されたら、すぐ消え始める。戦闘の時計は返事が来て finish するまで動かない
  assert.match(hook, /if \(!ready\.current\) setEnc\(e => \(e \? \{ \.\.\.e, out: true, early: true \} : e\)\)/)
  assert.match(hook, /hold: !!enc && \(!enc\.out \|\| enc\.early\)/)
  assert.match(hook, /\{ \.\.\.e, out: true, early: false \}/)
  // 消えたあとも finish までは透明なまま残る＝返事を待つあいだの画面は押せない（消す setEnc(null) は finish と cancel だけ）
  assert.match(read('V2capBossEncounter.jsx'), /beOut \$\{ENCOUNTER_OUT_MS\}ms ease-out forwards/)
  assert.equal(hook.match(/setEnc\(null\)/g).length, 2)
  // 先に出す戦闘は見た目だけ：本物と同じ関数で手元の値から作る・やめるボタンを出さない
  const src = read('V2capDungeon.jsx').replace(/\r\n/g, '\n')
  assert.match(src, /const shown = earlyFight \|\| fight/)
  assert.match(src, /startTryAtb\(\{ boss, diff, hp, seed: 0, snap: \{ prof, inv: inventory, at: Date\.now\(\) \} \}\)/)
  assert.match(src, /st=\{shown\.st\} runKey=\{shown\.runKey\}/)
  // ★サーバーへ送る記録は本物の戦闘だけ（pending に入るのは start の1か所・返事の種と写しで作った st）
  assert.equal(src.match(/pending\.current = \{/g).length, 1)
  assert.match(src, /const st = startTryAtb\(data\)\n\s*if \(!st\) \{[^\n]*\n\s*pending\.current = \{ runId: run\.id, st \}/)
  // 試し撃ちは押す前に finish する＝先に出す戦闘は要らない
  assert.match(read('V2capAtb.jsx'), /enc\.begin\([^\n]*\n\s*enc\.finish\(\)/)
})

test('【確定】2026-11-01 遭遇のイラストは押すまで出たまま（ユーザー「遭遇した後のタップで遷移するやつ、いつになったら実装するの？」＝前は押さなくても約1.4秒で勝手に進んでいた）', () => {
  const hook = readFileSync(new URL('./useBossEncounter.js', import.meta.url), 'utf8')
  // 消えるのは押されたときと、放っておかれたときだけ（短い時間で勝手に消える時計を置かない）
  assert.ok(!hook.includes('ENCOUNTER_MIN_MS'))
  assert.equal(hook.match(/setTimeout\(/g).length, 2, '時計は「放っておかれたとき」と「消える長さ」だけ')
  // 放っておかれてから戦闘の180秒を戦っても、サーバーの受付（v2cap_dungeon_try_end の c_late_min）に間に合う
  const sql = readFileSync(new URL('../../../supabase_v2cap_core.sql', import.meta.url), 'utf8')
  const lateMin = Number(/function public\.v2cap_dungeon_try_end[\s\S]*?c_late_min\s+constant int := (\d+);/.exec(sql)[1])
  assert.ok(ENCOUNTER_WAIT_MAX_MS >= 5 * 60 * 1000, '勝手に進むのは放っておかれたときだけ')
  assert.ok(ENCOUNTER_WAIT_MAX_MS + (DUNGEON_TRY_SEC + 60) * 1000 <= lateMin * 60 * 1000)
  // 押せると分かる一言
  assert.match(read('V2capBossEncounter.jsx'), /タップで戦闘開始/)
  // 裏で入口から戦闘へ変わっても作り直さない＝どの画面でも一番上の先頭（作り直すと、どん！がもう一度出る）
  const src = read('V2capDungeon.jsx').replace(/\r\n/g, '\n')
  assert.equal(src.match(/^\s*\{encounter\}$/gm).length, 3)
  assert.equal(src.match(/return <>\n\s*\{encounter\}\n/g).length, 3)
})

test('日本語の大きな文字は JP_BOLD の太字（切り抜きのグラデーションにしない）', () => {
  for (const f of ['V2capAtbTelop.jsx', 'V2capBossReward.jsx', 'V2capBossEncounter.jsx']) {
    const src = read(f)
    assert.match(src, /fontFamily: JP_BOLD, fontWeight:'bold'/, f)
    assert.ok(!/background-clip|backgroundClip/i.test(src), f)
  }
})

test('【確定】2026-11-01 開戦の動き：遭遇の絵を押す→ボスの動き→戦闘開始のテロップ→時計（ユーザー「これから戦闘するぞーって感じ」→選んだ「飛ばせない」）', () => {
  const t0 = 1000, intro = 1900
  // 動きのあいだも時計は止まったまま・テロップは動きのあと
  assert.equal(startTelopOn(t0, t0 + intro + START_TELOP_MS - 1, intro), true)
  assert.equal(startTelopOn(t0, t0 + intro + START_TELOP_MS, intro), false)
  assert.equal(startTelopShown(t0, t0 + intro - 1, intro), false)
  assert.equal(startTelopShown(t0, t0 + intro, intro), true)
  assert.equal(startTelopShown(t0, t0 + intro + START_TELOP_MS, intro), false)
  assert.equal(startTelopShown(null, 5000, intro), false, '絵を読んでいるあいだは出さない')
  // 動きが無い敵（ドット絵版・図鑑の絵）は今までどおりすぐテロップ
  assert.equal(startTelopShown(t0, t0), true)
  assert.equal(startTelopOn(t0, t0 + START_TELOP_MS), false)
  for (const key of ['varuzenoku', 'amaza', 'zerugiasu', 'enma']) {
    const a = bossIllustOf(key), m = a.intro
    // 新しい絵は描かない：技やバフのポーズの絵を借りる（読んであるので増えない）
    for (const p of Object.values(m.poses)) assert.ok(a.srcs.includes(p.src), key)
    // 動きの終わりごろにテロップ・動きが終わる前に時計が動かない
    assert.ok(m.telopAt <= m.totalMs, key)
    assert.ok(m.telopAt + START_TELOP_MS >= m.totalMs, key)
    // 技の動きの一覧には入れない（戦闘の技として流れない）
    assert.ok(!Object.values(a.motions).includes(m), key)
  }
  const src = read('V2capAtbFight.jsx')
  // 見せるだけ：st を変えず動きの記録に足すだけ。技の名前を付けない＝帯は出ない
  assert.match(src, /if \(bossArt\?\.intro\) fxRef\.current = \[\.\.\.fxRef\.current, \{ kind:'act', side:'b', motion: bossArt\.intro, t0: last\.current \/ 1000 \}\]/)
  // 遭遇の絵を出しているあいだは始めない＝見た目だけの戦闘から本物に替わる（runKey）前には流れない
  assert.ok(src.indexOf('if (paused || !artReady || hold) return') < src.indexOf('if (bossArt?.intro) fxRef.current'))
  // 始まるまでボスは登場の前の形で待つ（サーバーの返事を待つあいだ、立ったボスが一瞬見えない）
  assert.match(src, /introWait=\{introT0\.current === null\}/)
  // 飛ばせない：戦闘開始の前を押して飛ばす所を作らない（押して飛ばせるのは決着のあとだけ）
  assert.ok(!/introT0\.current = performance\.now\(\) -/.test(src))
  assert.equal((src.match(/onClick=\{skipEnding\}/g) || []).length, 1)
})
