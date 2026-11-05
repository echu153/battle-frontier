// ============================================================
// 「レベルキャップあり」版（v2cap）— 遭遇の絵を出しているあいだの決まり（見た目は components/V2capBossEncounter.jsx）
// ------------------------------------------------------------
// 【確定】2026-11-01 ユーザー「挑戦を押してから若干ラグがあってから始まるから、スムーズに遷移させるようにして」
//   「そもそも遭遇絵を使用してなくない？挑戦したら遭遇のイラストがどん！って出るようにしてほしい」：
//   押した瞬間に begin（サーバーを待たない）→ 裏で始める準備（サーバーの返事）→ finish：押されたら消える。
//   消え始めたら戦闘の時計が動く（hold）＝戦闘開始のテロップが遭遇の絵に隠れない。始められなかったら cancel（わけは入口に出る）
// 【確定】同じ日 ユーザー「遭遇イラスト出たときはタップしたら戦闘画面に遷移できるようにして」：
//   押したら、絵を待たない（絵が届いていなければ戦闘の画面の「読みこみ中」へ）
// 【確定】同じ日 ユーザー「遭遇時にタップ押したら画面遷移ができてない」：前はサーバーの返事が届くまで絵が消えず、押しても何も起きないように見えた（手元の測定で約0.6秒・遅い回線ならもっと）。
//   finish の前に押されたら、すぐ消え始めて early を立てる＝呼ぶ側が見た目だけの戦闘の画面を先に出す（V2capDungeon.jsx）。戦闘の時計は finish まで動かない（hold）。
//   消えたあとも finish までは透明なまま置いておく＝返事を待つあいだの画面は押せない
// 【確定】同じ日 ユーザー「遭遇した後のタップで遷移するやつ、いつになったら実装するの？」：前は押さなくても約1.4秒で勝手に進み、タップで進む形に見えなかった。
//   絵は押すまで出たまま（1.4秒で消すのはやめた）。放っておかれたときだけ ENCOUNTER_WAIT_MAX_MS で進む
// ============================================================
import { useCallback, useRef, useState } from 'react'
import { preloadArt } from './artPreload.js'

// 押されないまま、これだけたったら進む（サーバーは挑戦を始めてから25分までしか終わりを受け付けない＝v2cap_dungeon_try_end の c_late_min。戦闘の念のための上限10分が入る長さ）
export const ENCOUNTER_WAIT_MAX_MS = 10 * 60 * 1000
export const ENCOUNTER_OUT_MS = 240    // 消える長さ

export const useBossEncounter = () => {
  const [enc, setEnc] = useState(null)   // { id, bossKey, diffKey, hp（ボスのいまのHP・分かっていれば）, out（消え始めた）, early（finish の前に押された） }
  const wait = useRef(null)
  const skip = useRef(null)
  const ready = useRef(false)            // finish が呼ばれた
  const lastId = useRef(0)
  // 押した瞬間に出す。srcs＝戦闘に要る絵（裏で読んでおく＝押したらすぐ戦闘の絵が出る）
  const begin = useCallback((bossKey, diffKey, srcs = [], hp = null) => {
    const id = ++lastId.current
    ready.current = false
    setEnc({ id, bossKey, diffKey, hp, out: false, early: false })
    preloadArt(srcs)
    const tooLong = new Promise((res) => setTimeout(res, ENCOUNTER_WAIT_MAX_MS))
    const tapped = new Promise((res) => { skip.current = res })
    wait.current = Promise.race([tapped, tooLong])
  }, [])
  // 準備ができたら呼ぶ。押されるまで待ってから消す（押されていれば待たない）
  const finish = useCallback(async () => {
    const id = lastId.current
    ready.current = true
    await wait.current
    if (lastId.current !== id) return
    setEnc(e => (e ? { ...e, out: true, early: false } : e))
    setTimeout(() => { if (lastId.current === id) setEnc(null) }, ENCOUNTER_OUT_MS)
  }, [])
  const cancel = useCallback(() => { lastId.current += 1; setEnc(null) }, [])
  // 押された：絵を待たない。finish の前なら、すぐ消え始める（early）
  const tap = useCallback(() => {
    skip.current?.()
    if (!ready.current) setEnc(e => (e ? { ...e, out: true, early: true } : e))
  }, [])
  return { enc, hold: !!enc && (!enc.out || enc.early), begin, finish, cancel, skip: tap }
}
