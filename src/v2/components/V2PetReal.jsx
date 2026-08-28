import { useEffect, useRef, useState } from 'react'
import { btn, miniBtn, TEXT } from './v2ui.js'
import {
  playsLeft, countsOf, walkPt, WALK_MAX_STEPS,
  KANJI_GRADES, kanjiPt, makeKanjiQuiz,
} from '../lib/pet.js'
import { kanjiWordsOf } from '../lib/kanjiData.js'
import { createStepDetector, needsMotionPermission } from '../lib/steps.js'

// ============================================================
// ペット — 現実の行動でステを伸ばす2つ（運動・漢字）
// ------------------------------------------------------------
// ゲーム内で完結する3つ（神経衰弱・積み上げ耐久・コイントス）は V2Pet.jsx。
// こちらは端末のセンサーと漢字のデータが要るので分けてある。
// 数え方の正はどちらも src/v2/lib/pet.js。
// ============================================================

const cell = { border:'1px solid #0044aa', background:'#000818' }

// ============================================================
// 運動 — 歩数でSTR
// ------------------------------------------------------------
// ★歩数の判定は src/v2/lib/steps.js（別プロジェクト「歩くRPG」で実機の実績が
//   あるものをそのまま持ってきた）。制約もそちらと同じ2つ。
//     ・https でないとセンサーの値が来ない（LANの http では無反応）
//     ・**画面を開いているあいだしか数えられない**
//   iOS 13+ は許可をユーザー操作から求める必要がある
// ============================================================
export function WalkGame({ state, day, onWalk, onBack }) {
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState('')
  const [live, setLive] = useState(0)          // この画面で数えたぶん
  const detector = useRef(null)
  const seen = useRef(false)
  const gravitySeen = useRef(false)
  const base = countsOf(state, day).walkSteps || 0
  const steps = base + live
  const pt = walkPt(steps)

  // ハンドラは ref 越しに呼ぶ（登録し直さずに最新の値を見るため）
  const onMotion = useRef(null)
  onMotion.current = (e) => {
    const acc = e.accelerationIncludingGravity
    if (!acc) return
    seen.current = true
    if (Math.abs(acc.x || 0) + Math.abs(acc.y || 0) + Math.abs(acc.z || 0) > 3) gravitySeen.current = true
    const n = detector.current?.push(
      { x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 },
      e.timeStamp || performance.now(),
    ) || 0
    if (n > 0) setLive(v => v + n)
  }

  // 数えたぶんはそのつど記録する。1,000歩の区切りを跨いだときだけptが入る
  useEffect(() => {
    if (live > 0) onWalk(base + live)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  useEffect(() => {
    if (!running) return
    const h = (e) => onMotion.current(e)
    window.addEventListener('devicemotion', h)
    const id = setTimeout(() => {
      if (!seen.current) {
        setNotice('センサーの値が届いていません。PCでは動きません。スマホ＋https:// でお試しください。')
      } else if (!gravitySeen.current) {
        setNotice('この端末では重力込みの加速度が取れないため、歩数を判定できません。')
      }
    }, 2500)
    return () => { window.removeEventListener('devicemotion', h); clearTimeout(id) }
  }, [running])

  const start = async () => {
    setNotice('')
    if (needsMotionPermission()) {           // iOS 13+
      try {
        const res = await DeviceMotionEvent.requestPermission()
        if (res !== 'granted') { setNotice('センサーの利用が許可されませんでした。'); return }
      } catch {
        setNotice('センサーの許可を求められませんでした。https:// で開いているか確かめてください。')
        return
      }
    }
    detector.current = createStepDetector({ strictness: 'normal' })
    seen.current = false
    gravitySeen.current = false
    setRunning(true)
  }

  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#ffcc00', fontSize:'11px' }}>{steps}歩</span>
        <span style={{ color:TEXT.empty, fontSize:'10px' }}>
          1,000歩ごとに10pt・{WALK_MAX_STEPS.toLocaleString()}歩で頭打ち
        </span>
      </div>

      <div style={{ ...cell, padding:'20px', textAlign:'center', marginBottom:'10px' }}>
        <div style={{ fontSize:'30px', color:'#ffcc00' }}>{steps}</div>
        <div style={{ color:TEXT.sub, fontSize:'11px', marginTop:'6px' }}>
          STR {pt}pt ／ {WALK_MAX_STEPS.toLocaleString()}歩で80pt
        </div>
        <div style={{ ...cell, height:'6px', marginTop:'10px' }}>
          <div style={{ height:'100%', background:'#ffcc00',
            width:`${Math.min(100, steps / WALK_MAX_STEPS * 100)}%` }} />
        </div>
      </div>

      {!running
        ? <button onClick={start} style={btn('#ffcc00')}>数えはじめる</button>
        : <div style={{ color:'#44ff88', fontSize:'11px' }}>数えています。画面を開いたままにしてください。</div>}

      <div style={{ color:TEXT.empty, fontSize:'10px', marginTop:'8px', lineHeight:1.7 }}>
        ※ スマホを持って歩いてください。この画面を開いているあいだだけ数えます。<br />
        ※ https:// で開いていないとセンサーが動きません。
      </div>

      {notice && <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'8px' }}>{notice}</div>}
    </div>
  )
}

// ============================================================
// 漢字 — 正解でINT。1問＝今日の1回ぶん
// ------------------------------------------------------------
// 出題は配当漢字の一覧から組み立てる（src/v2/lib/kanjiData.js）。
// 級を選ぶと、その級の熟語から読み問題と書き問題が混ざって出る
// ============================================================
export function KanjiGame({ state, day, onBegin, onDone, onBack }) {
  const [grade, setGrade] = useState(null)
  const [quiz, setQuiz] = useState(null)
  const [judged, setJudged] = useState(null)   // { picked, right, pt }
  const [right, setRight] = useState(0)
  const [asked, setAsked] = useState(0)
  const left = playsLeft(state, 'kanji', day)

  // 1問出す。★出題の前に今日の1問ぶんを使う（見てからやめる、を封じる）
  const next = (g) => {
    if (!onBegin('kanji')) { setQuiz(null); return }
    setQuiz(makeKanjiQuiz(g))
    setJudged(null)
    setAsked(n => n + 1)
  }

  const answer = (choice) => {
    if (judged || !quiz) return
    const ok = choice === quiz.answer
    const pt = ok ? kanjiPt(grade, 1) : 0
    setJudged({ picked: choice, right: ok, pt })
    if (!ok) return
    setRight(n => n + 1)
    onDone('kanji', { int_stat: pt }, `${quiz.word}（${quiz.yomi}）`)
  }

  // ===== 級を選ぶ =====
  if (!grade) {
    return (
      <div style={{ marginTop:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
          <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
          <span style={{ color:TEXT.empty, fontSize:'10px' }}>あと{left}問</span>
        </div>
        <div style={{ color:TEXT.label, fontSize:'11px', marginBottom:'8px' }}>級を選んでください</div>
        <div style={{ display:'grid', gap:'6px' }}>
          {KANJI_GRADES.map(g => (
            <button key={g.key} onClick={() => { setGrade(g.key); next(g.key) }} disabled={left === 0}
              style={{ ...cell, textAlign:'left', padding:'9px 10px', fontFamily:'monospace',
                color: left === 0 ? TEXT.empty : '#cc44ff',
                cursor: left === 0 ? 'not-allowed' : 'pointer' }}>
              <span style={{ fontSize:'13px' }}>{g.label}</span>
              <span style={{ color:TEXT.sub, fontSize:'10px', marginLeft:'10px' }}>
                1問 {kanjiPt(g.key, 1)}pt ／ {kanjiWordsOf(g.key).length}語
              </span>
            </button>
          ))}
        </div>
        <div style={{ color:TEXT.empty, fontSize:'10px', marginTop:'8px', lineHeight:1.7 }}>
          ※ 上の級ほど1問のptが高くなります。<br />
          ※ 1問出すたびに今日の1問ぶんを使います。
        </div>
      </div>
    )
  }

  // ===== 出題中 =====
  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#cc44ff', fontSize:'11px' }}>
          {KANJI_GRADES.find(g => g.key === grade)?.label}
        </span>
        <span style={{ color:'#44ff88', fontSize:'11px' }}>{right}/{asked}問 正解</span>
        <span style={{ color:TEXT.empty, fontSize:'10px' }}>あと{left}問</span>
      </div>

      {!quiz && (
        <div style={{ ...cell, padding:'12px' }}>
          <div style={{ color:'#ff8844', fontSize:'11px' }}>今日のぶんは使い切りました。</div>
          <button onClick={onBack} style={{ ...btn('#88aaff'), marginTop:'8px' }}>もどる</button>
        </div>
      )}

      {quiz && (
        <div>
          <div style={{ ...cell, padding:'18px', textAlign:'center', marginBottom:'10px' }}>
            <div style={{ color:TEXT.label, fontSize:'10px', marginBottom:'8px' }}>
              {quiz.type === 'read' ? '読みは？' : 'この読みの熟語は？'}
            </div>
            <div style={{ fontSize:'28px', color:'#cfe2ff', letterSpacing:'2px' }}>{quiz.ask}</div>
          </div>

          <div style={{ display:'grid', gap:'6px' }}>
            {quiz.choices.map(c => {
              const isAnswer = judged && c === quiz.answer
              const isMiss = judged && c === judged.picked && !judged.right
              return (
                <button key={c} onClick={() => answer(c)} disabled={!!judged}
                  style={{ ...cell, padding:'10px', fontFamily:'monospace', fontSize:'14px',
                    borderColor: isAnswer ? '#44ff88' : isMiss ? '#ff4444' : '#0044aa',
                    color: isAnswer ? '#44ff88' : isMiss ? '#ff4444' : '#cfe2ff',
                    cursor: judged ? 'default' : 'pointer' }}>
                  {c}
                </button>
              )
            })}
          </div>

          {judged && (
            <div style={{ ...cell, padding:'8px', marginTop:'10px' }}>
              <div style={{ color: judged.right ? '#44ff88' : '#ff8844', fontSize:'12px' }}>
                {judged.right ? `正解！ INT +${judged.pt}pt` : '不正解'}
              </div>
              <div style={{ color:TEXT.sub, fontSize:'11px', marginTop:'4px' }}>
                {quiz.word}（{quiz.yomi}）
              </div>
              <button onClick={() => next(grade)} disabled={left === 0}
                style={{ ...btn(left === 0 ? '#62789a' : '#cc44ff'), marginTop:'8px' }}>
                {left === 0 ? '今日はおしまい' : '次の問題'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
