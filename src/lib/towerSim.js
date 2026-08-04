// ============================================================
// エンドレスタワーの一括シミュレーション（開発用・is_admin限定）
// ------------------------------------------------------------
// ⚠これはブラウザの中で動かす前提のモジュール。
//   スキルとクラスの対応は DB の skills テーブルにしか無く、
//   プレイヤーの実効ステータスも装備・紋章・ペット込みで初めて出る。
//   node 側で模擬プレイヤーを組んで測っても実態とかけ離れるため、
//   「実データを読める場所」で回すのが唯一意味のある測り方。
//
// 使い方（Tower.jsx の開発パネルから）:
//   1. loadAllSkills() で skills テーブルを丸ごと取る
//   2. buildClassSets() でクラスごとの「再修練5・終盤の並び」を組む
//   3. simulateAll() で 層×クラス の突破率を出す
// ============================================================
import { simulateTowerBattle, buildStageEnemies } from './towerBattle'
import { getFloor, BOSS_RUN_STAGES, RUN_POTION_LIMIT } from './tower'

// 上位職（初期職は塔の想定外なので測らない）
export const ADVANCED_CLASSES = [
  '侍', '狂戦士', '狩人', '暗殺者', '元素使い', '死霊使い', '聖職者', '異端審問官',
  '賢者', 'サイキッカー', '体術師', '魔銃士', 'ギャンブラー', '魔法剣士', '聖騎士',
  '竜騎士', '精霊召喚士', '式神使い', 'ブリーダー',
]

// skills テーブルを丸ごと読む（クラスとの対応はここにしか無い）
export async function loadAllSkills(supabase) {
  const { data, error } = await supabase.from('skills').select('*')
  if (error) throw error
  return data || []
}

// クラスごとに「終盤の並び」を組む。
//  ・パッシブは専用枠1つ（required_lv が一番高いもの＝終盤に覚えるもの）
//  ・通常スキルは required_lv の高い順に5つ。使う順は覚えた順（低い方から）に並べる
//  ・共通スキルも候補に入れる（実プレイヤーも組める）
export function buildClassSets(allSkills, classes = ADVANCED_CLASSES) {
  const sets = {}
  for (const cls of classes) {
    const mine = allSkills.filter(s => s.class_name === cls || s.class_name === '共通')
    const passives = mine.filter(s => s.type === 'パッシブ')
      .sort((a, b) => (b.required_lv || 0) - (a.required_lv || 0))
    const actives = mine.filter(s => s.type !== 'パッシブ')
      .sort((a, b) => (b.required_lv || 0) - (a.required_lv || 0))
      .slice(0, 5)
      .sort((a, b) => (a.required_lv || 0) - (b.required_lv || 0))
    const set = []
    if (passives[0]) set.push({ skills: passives[0], use_count: 1 })
    for (const s of actives) set.push({ skills: s, use_count: 1 })
    sets[cls] = set
  }
  return sets
}

// 6連戦を1回通す。抜けられたら true
export function runBossRun({ eff, equipment, skillSets, profile, floor, tree, targetMode, playerItem }) {
  const fd = getFloor(floor)
  if (!fd) return { cleared: false, stage: 0 }
  let hp = eff.hp_max, mp = eff.mp_max, potion = 0
  for (let s = 0; s < BOSS_RUN_STAGES.length; s++) {
    const r = simulateTowerBattle({
      eff, equipment, skillSets, profile,
      enemies: buildStageEnemies(fd, s), floorData: fd, tree, targetMode,
      startHp: hp, startMp: mp, playerItem,
      potionUsed: potion, potionLimit: RUN_POTION_LIMIT,
    })
    if (!r.win) return { cleared: false, stage: s }
    hp = r.hp; mp = r.mp; potion = r.potionUsed
  }
  return { cleared: true, stage: BOSS_RUN_STAGES.length }
}

// 層×クラスの突破率を出す。
//  onProgress(done, total, 途中経過) を呼ぶので、呼び出し側で進捗を出せる。
//  重いので await を挟んでUIを固めない。
export async function simulateAll({
  supabase, eff, equipment, profile, tree, targetMode, playerItem,
  floors, tries = 10, classes = ADVANCED_CLASSES, onProgress,
}) {
  const allSkills = await loadAllSkills(supabase)
  const sets = buildClassSets(allSkills, classes)
  const rows = []
  const total = classes.length * floors.length
  let done = 0
  for (const cls of classes) {
    const skillSets = sets[cls] || []
    // ★再修練5：executeSkill は profile.class と skill.class_name が一致するときだけ
    //   retraining の段階強化を乗せる。クラスごとに profile を差し替える必要がある。
    const p = { ...profile, class: cls, retraining: { ...(profile.retraining || {}), [cls]: 5 } }
    const row = { cls, skills: skillSets.map(s => s.skills.name), rates: {} }
    for (const floor of floors) {
      let ok = 0
      for (let i = 0; i < tries; i++) {
        if (runBossRun({ eff, equipment, skillSets, profile: p, floor, tree, targetMode, playerItem }).cleared) ok++
      }
      row.rates[floor] = ok / tries
      done++
      if (onProgress) onProgress(done, total, cls, floor)
      // UIを固めないよう1層ごとに制御を返す
      await new Promise(r => setTimeout(r, 0))
    }
    rows.push(row)
  }
  return rows
}
