// v2cap：神殿（転職）の画面の決まり（node --test）
// 【確定】2026-10-26 ユーザー指示：
//   ・「このクラスに転職する」を押したら確認のポップアップ。転職の前後のステと増減（＋／−／±0）を出す
//   ・転職し終わったら画面のいちばん上へ（確認のポップアップ＝V2Modal が「実行」のあと閉じたときに戻す）
//   ・クラスのステ（CLASS LVごとに入る量）は神殿に書かない・「就く条件」→「転職条件」・パッシブはスキルの欄の先頭
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INITIAL_STATS, calcPower } from '../core/stats.js'
import { statBreakdown, statBreakdownAs } from './loadout.js'
import { jobBonusStats } from './jobs.js'

const TEMPLE = readFileSync(new URL('../components/V2capTemple.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('転職したときのステ＝その職業のクラスのステ・その職業で装備できない武器は外した形', () => {
  const inv = [{ id: 1, base_id: '3N:刀', ilv: 30 }]
  const prof = { username:'t', class:'剣士', lv: 30, ...INITIAL_STATS, equipped: { weapon: 1 },
    jobs: { 剣士: { lv: 30, exp: 0 }, 戦士: { lv: 12, exp: 0 } }, learned: [], skill_sets: {} }
  const now = statBreakdown(prof, inv)
  const toSamurai = statBreakdownAs(prof, inv, '侍')
  const toWarrior = statBreakdownAs(prof, inv, '戦士')
  assert.deepEqual(toSamurai.job, jobBonusStats('侍', 1), '就いたことのない職業はCLASS LV1')
  assert.deepEqual(toWarrior.job, jobBonusStats('戦士', 12), 'CLASS LVは職業ごとに続きから')
  assert.ok(calcPower(now.gear) > 0 && calcPower(toSamurai.gear) === calcPower(now.gear), '侍は刀を装備できる')
  assert.equal(calcPower(toWarrior.gear), 0, '戦士は刀を装備できない＝外した形で数える')
  assert.equal(prof.class, '剣士', 'もとのプロフィールは書き換えない')
})

test('「このクラスに転職する」は確認のポップアップを開く（前後のステと増減・閉じたら上へ）', () => {
  assert.ok(TEMPLE.includes('<button onClick={onAsk}'), '押すと確認を開く（すぐ転職しない）')
  assert.ok(!TEMPLE.includes('<button onClick={onChange}'), 'ボタンから直接転職しない')
  const modal = TEMPLE.match(/<V2Modal\b[^>]*>/g) || []
  const confirm = modal.find(m => m.includes('転職の確認'))
  assert.ok(confirm, '転職の確認のポップアップがある')
  assert.ok(confirm.includes('onConfirm={onConfirm}'), '「転職する」を押して転職する')
  assert.ok(!confirm.includes('keepScroll'), '転職し終わったら画面のいちばん上へ（keepScroll にしない）')
  assert.ok(TEMPLE.includes('statBreakdownAs(prof, inventory, cls)'), '転職後のステは statBreakdownAs で数える')
  assert.ok(TEMPLE.includes("'±0'") && TEMPLE.includes('`+${') && TEMPLE.includes('`−${'), '増減は＋／−／±0')
  assert.ok(TEMPLE.includes('<div>{cls}のCLASS LV、ステータスが適用されます。</div>'), '確認の文（ユーザー指示の言い方）')
  assert.ok(!TEMPLE.includes('LVはそのまま、CLASS LVは'), '前の長い説明は出さない')
  // 結果は詳細の画面のいちばん上（戻った先で見える場所）に出す
  assert.ok(TEMPLE.indexOf('{msg && ') < TEMPLE.indexOf('<ArtPanel'), '「〇〇になった！」はイラストより上')
})

test('クラスのステは神殿に書かない・「転職条件」・パッシブはスキルの欄の先頭', () => {
  assert.ok(!TEMPLE.includes('📈 クラスのステ'), 'クラスのステの欄は出さない')
  assert.ok(!TEMPLE.includes('jobBonusText'), 'クラスのステの文も作らない')
  assert.ok(!TEMPLE.includes('就く条件：'), '「就く条件」は「転職条件」に')
  assert.ok(TEMPLE.includes('転職条件：'))
  const skills = TEMPLE.indexOf('📖 スキル')
  assert.ok(skills > 0 && skills < TEMPLE.indexOf('>パッシブ</span>') && TEMPLE.indexOf('>パッシブ</span>') < TEMPLE.indexOf('{order.map('),
    'パッシブはスキルの見出しのすぐ下・覚える技より前')
  assert.ok(TEMPLE.includes("border:'1px solid #ffcc66', background:'#000818',"), 'パッシブの枠はグラデーションなし（ふつうの地の色）')
  assert.ok(!TEMPLE.includes('※ 編成しなくても'), 'パッシブに「編成しなくても〜」の一言を書かない')
  // 覚える技の行は「LV1　手裏剣　習得済み／未習得」
  assert.ok(TEMPLE.includes('>LV{at[i]}</span>') && !TEMPLE.includes('>CLASS LV{at[i]}</span>'), '覚えるLVは「LV1」')
  assert.ok(TEMPLE.includes("{has ? '習得済み' : '未習得'}"), '「習得済み／未習得」')
})

// 【確定】2026-10-26 ユーザー指示：「スタック」と書くのは**相手のスタックの数を数えるときだけ**（「出血スタック×5%」「動揺1スタックにつき」）。
//   付けるときは「動揺+1」「出血+2」のまま（ユーザー「ここら辺は普通に＋１でいい、対象者のスタック数を数えるときだけでいい」）。「重なり数」とは書かない
test('「スタック」は相手のスタックの数を数えるときだけ（付けるときは「+1」・「重なり数」と書かない）', async () => {
  const { SKILL_BY_NAME } = await import('./skills.js')
  const { ascSkillDetail } = await import('./ascension.js')
  const desc = (n) => SKILL_BY_NAME[n].desc
  // 数えるとき
  assert.equal(desc('血の匂い'), '出血している相手への与ダメージ+（出血スタック×5%）')
  assert.equal(desc('急所突き'), '相手の出血スタックをすべて消費し、1スタックにつき威力+25%')
  assert.ok(desc('精神感応').includes('動揺は1スタックにつき'), desc('精神感応'))
  assert.equal(desc('メンタルクラッシュ'), '相手の動揺1スタックにつき威力+6%（最大+30%）。動揺は残る')
  for (const n of ['メンタルクラッシュ', 'サイコブラスト', 'マインドスパイク']) assert.ok(ascSkillDetail(n).includes('動揺1スタックにつき'), `${n}：${ascSkillDetail(n)}`)
  assert.ok(ascSkillDetail('急所突き').includes('出血1スタックにつき'), ascSkillDetail('急所突き'))
  // 付けるとき・数えないとき
  assert.equal(desc('裂傷'), '相手の出血+2')
  assert.equal(desc('テレキネシス'), '念力で叩きつける。50%で動揺+1')
  assert.equal(desc('マインドジャック'), '動揺+2・20%で狂乱')
  assert.ok(desc('マインドブレイク').endsWith('動揺+1'), desc('マインドブレイク'))
  assert.ok(!desc('絶命').includes('スタック'), desc('絶命'))
  for (const n of ['裂傷', 'テレキネシス', 'サイコショット']) assert.ok(!ascSkillDetail(n).includes('スタック'), `${n}：${ascSkillDetail(n)}`)
  assert.ok(Object.values(SKILL_BY_NAME).every(s => !s.desc?.includes('スタック+')), '付けるときに「スタック+」と書かない')
  // 「重なり数」とは書かない
  const all = Object.values(SKILL_BY_NAME).filter(s => s.cls && s.desc).map(s => `${s.name}：${s.desc}`)
  assert.deepEqual(all.filter(t => t.includes('重なり数')), [], '技の説明に「重なり数」を書かない')
})
