// ============================================================
// 「レベルキャップあり」版（v2cap）— 遭遇の絵を出しているあいだの決まり（見た目は components/V2capBossEncounter.jsx）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦を押してから若干ラグがあってから始まるから、スムーズに遷移させるようにして」
//   「そもそも遭遇絵を使用してなくない？挑戦したら遭遇のイラストがどん！って出るようにしてほしい」：
//   押した瞬間に begin（サーバーを待たない）→ 裏で始める準備（サーバーの返事・絵）→ finish：最低 ENCOUNTER_MIN_MS 見せて（押すと飛ばせる）消える。
//   消え始めたら戦闘の時計が動く（hold）＝戦闘開始のテロップが遭遇の絵に隠れない。始められなかったら cancel（わけは入口に出る）
// ============================================================
import { useCallback, useRef, useState } from 'react'
import { preloadArt } from './artPreload.js'

export const ENCOUNTER_MIN_MS = 1400   // 最低これだけ見せる（押すと飛ばせる）
export const ENCOUNTER_OUT_MS = 240    // 消える長さ

export const useBossEncounter = () => {
  const [enc, setEnc] = useState(null)   // { id, bossKey, diffKey, out（消え始めた） }
  const wait = useRef(null)
  const skip = useRef(null)
  const lastId = useRef(0)
  // 押した瞬間に出す。srcs＝戦闘に要る絵（そろうまで消えない＝「読みこみ中」を見せない）
  const begin = useCallback((bossKey, diffKey, srcs = []) => {
    const id = ++lastId.current
    setEnc({ id, bossKey, diffKey, out: false })
    wait.current = Promise.all([new Promise((res) => { skip.current = res; setTimeout(res, ENCOUNTER_MIN_MS) }), preloadArt(srcs)])
  }, [])
  // 準備ができたら呼ぶ。見せる長さと絵を待ってから消す
  const finish = useCallback(async () => {
    const id = lastId.current
    await wait.current
    if (lastId.current !== id) return
    setEnc(e => (e ? { ...e, out: true } : e))
    setTimeout(() => { if (lastId.current === id) setEnc(null) }, ENCOUNTER_OUT_MS)
  }, [])
  const cancel = useCallback(() => { lastId.current += 1; setEnc(null) }, [])
  return { enc, hold: !!enc && !enc.out, begin, finish, cancel, skip: () => skip.current?.() }
}
