import { useEffect, useState } from 'react'
import V2Modal from './V2Modal.jsx'
import { tutorialOf, seenKey } from '../lib/tutorial.js'
import { loadPref, savePref } from '../lib/prefs.js'
import { TEXT } from './v2ui.js'

// バトルフロンティアⅡ（リメイク版）— チュートリアル（ヘルプ）
// ------------------------------------------------------------
// ★どのコンテンツも、初めて開いたときに説明のポップアップが出る（2026-08-23 ユーザー指示）。
//   閉じたあとも ❓ヘルプ からいつでも読み直せる。
//
// 使い方：各画面の見出しの横に <V2Help id="market" /> を置くだけ。
//   ・初回は自動で開く（見たかどうかは localStorage。★SQLを増やさない）
//   ・2回目からはボタンだけ出る
// ★文章は src/v2/lib/tutorial.js が正。ここには文章を書かない
//   （説明が画面のあちこちに散らばると、直すときに探すことになる）。

// ★自動で開くのは**1回の読み込みにつき1つだけ**。
//   ホームには常に出ている画面がいくつもあるので、素直に書くとポップアップが重なる。
//   譲ったほうは「見た」にしないので、次に開いたときに出る＝順番に出てくる。
let autoTaken = false

export default function V2Help({ id, auto = true, label = 'ヘルプ' }) {
  const t = tutorialOf(id)
  const [open, setOpen] = useState(false)

  // 初回だけ自動で開く。★開いた時点で「見た」にする（読まずに閉じても二度は出さない）
  useEffect(() => {
    if (!t || !auto) return
    if (loadPref(seenKey(id), false)) return
    if (autoTaken) return          // このページではもう別のが出ている
    autoTaken = true
    savePref(seenKey(id), true)
    setOpen(true)
  }, [id, t, auto])

  if (!t) return null
  return (
    <>
      <button onClick={() => setOpen(true)} title={`${t.title}の説明`}
        style={{
          background:'transparent', border:'1px solid #35506b', borderRadius:'999px',
          color: TEXT.label, cursor:'pointer', fontFamily:'monospace', fontSize:'10px',
          lineHeight:1, padding:'3px 8px',
        }}>
        ❓ {label}
      </button>
      {open && <TutorialModal id={id} onClose={() => setOpen(false)} />}
    </>
  )
}

// ポップアップ本体。ヘルプ以外（初回の自動表示）からも使う
export function TutorialModal({ id, onClose }) {
  const t = tutorialOf(id)
  if (!t) return null
  return (
    <V2Modal title={`${t.icon} ${t.title}`} color="#88ccff" closeLabel="閉じる" onClose={onClose}>
      {t.lines.map((l, i) => (
        <div key={i} style={{ color:'#cfe2ff', marginBottom:'4px' }}>{l}</div>
      ))}
      {/* 補足は箇条書きにしない。最後に1文だけ置く（2026-08-25 ユーザー指示） */}
      {t.note && (
        <div style={{ color:'#93a9be', marginTop:'12px' }}>{t.note}</div>
      )}
      <div style={{ color: TEXT.empty, fontSize:'10px', marginTop:'10px' }}>
        この説明は、いつでも ❓ヘルプ から読み直せます。
      </div>
    </V2Modal>
  )
}
