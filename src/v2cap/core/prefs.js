// ============================================================
// バトルフロンティアⅡ（リメイク版）— 画面の設定を覚えておく
// ------------------------------------------------------------
// 折りたたみの開閉や一覧の絞り込みは、**画面を移っても再読み込みしても元に戻さない**。
// 毎回ステータスを閉じ直す・毎回同じ絞り込みをやり直す、が地味に効くため。
// 旧版も同じ考え方で localStorage を使っている（`statExpanded`）。
//
// ★保存先は localStorage。サーバーには送らない＝端末ごとの設定。
//   読めない・書けない環境（プライベートモード等）でも落ちないよう、全部 try で囲う。
// ============================================================
import { useState } from 'react'

const keyOf = (name) => `v2:${name}`

export const loadPref = (name, fallback) => {
  try {
    const raw = localStorage.getItem(keyOf(name))
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export const savePref = (name, value) => {
  try { localStorage.setItem(keyOf(name), JSON.stringify(value)) } catch { /* 保存できなくても動く */ }
}

// ★オブジェクトの設定は「既定値にあるキーだけ」拾う。
//   あとから項目を足したとき（絞り込みに「強化値」を足したときなど）、
//   古い設定がそのまま入って undefined になるのを防ぐ。
export const mergePref = (name, fallback) => {
  const saved = loadPref(name, null)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return fallback
  const out = { ...fallback }
  for (const k of Object.keys(fallback)) if (k in saved) out[k] = saved[k]
  return out
}

// useState と同じ使い勝手で、変えるたびに保存する。
// merge を true にするとオブジェクト用の読み方（上の mergePref）になる
export const useStored = (name, fallback, merge = false) => {
  const [value, setValue] = useState(() => (merge ? mergePref(name, fallback) : loadPref(name, fallback)))
  const set = (next) => setValue(cur => {
    const v = typeof next === 'function' ? next(cur) : next
    savePref(name, v)
    return v
  })
  return [value, set]
}
