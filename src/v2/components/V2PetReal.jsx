import { useEffect, useRef, useState } from 'react'
import { btn, miniBtn, TEXT } from './v2ui.js'
import {
  playsLeft, countsOf, walkPt, WALK_MAX_STEPS,
  KANJI_GRADES, kanjiPt, makeKanjiQuiz, recordKanji, kanjiMasteredCount,
  KANJI_SET_SIZE,
} from '../lib/pet.js'
import { kanjiWordsOf } from '../lib/kanjiData.js'
import { createStepDetector, needsMotionPermission } from '../lib/steps.js'
import { loadPref, savePref } from '../lib/prefs.js'

// 漢字の覚え具合の保存先。★育ち具合(pt)とは別に持つ＝勉強の記録なので消えないほうがよい
const LOG_KEY = 'petKanji'

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
  // ★1セット5問で区切る（2026-08-29 ユーザー指示）。
  //   前は20問ノンストップだったので、終わりが見えず「一生続く」状態だった。
  const [inSet, setInSet] = useState(0)        // このセットで何問目か（1〜5）
  const [setRight, setSetRight] = useState(0)  // このセットの正解数
  const [setPt, setSetPt] = useState(0)        // このセットで入ったpt
  const [done, setDone] = useState(false)      // セットを終えて結果を出している
  const [drill, setDrill] = useState(false)    // 練習モード（ptは入らない）
  // ★覚え具合。**これが「毎日やれば実力がつく」の中身**。
  //   間違えた語ほど濃く出す（重みづけは pet.js の kanjiWeightOf）
  const [log, setLog] = useState(() => loadPref(LOG_KEY, {}) || {})
  const recent = useRef([])                    // 直近に出した語。続けて同じ語を出さない
  const left = playsLeft(state, 'kanji', day)

  const saveLog = (next) => { savePref(LOG_KEY, next); setLog(next) }

  // 1問出すだけ（セットの中の次の問題）
  const ask = (g) => {
    setQuiz(makeKanjiQuiz(g, Math.random, null, log, recent.current))
    setJudged(null)
    setInSet(n => n + 1)
  }

  // 1セット始める。★始めた時点で今日の1セットぶんを使う（見てからやめる、を封じる）。
  //   練習モードでは回数を使わない代わりに、ptも入らない
  const startSet = (g, practice = drill) => {
    if (!practice && !onBegin('kanji')) { setQuiz(null); return }
    setInSet(0)
    setSetRight(0)
    setSetPt(0)
    setDone(false)
    ask(g)
  }

  const answer = (choice) => {
    if (judged || !quiz) return
    const ok = choice === quiz.answer
    const pt = ok && !drill ? kanjiPt(grade, 1) : 0
    setJudged({ picked: choice, right: ok, pt })
    saveLog(recordKanji(log, quiz.word, ok))
    recent.current = [quiz.word, ...recent.current].slice(0, 6)
    if (!ok) return
    setSetRight(n => n + 1)
    setSetPt(n => n + pt)
    if (pt > 0) onDone('kanji', { int_stat: pt }, `${quiz.word}（${quiz.yomi}）`)
  }

  // 答え合わせのあと。5問目なら結果へ、まだならその場で次の問題
  const after = () => {
    if (inSet >= KANJI_SET_SIZE) { setDone(true); setQuiz(null); return }
    ask(grade)
  }

  // 今日のぶんを使い切ったら、練習モードへ切り替えて続けられる（こちらも5問で区切る）
  const toDrill = () => {
    setDrill(true)
    setInSet(0); setSetRight(0); setSetPt(0); setDone(false)
    setQuiz(makeKanjiQuiz(grade, Math.random, null, log, recent.current))
    setJudged(null)
    setInSet(1)
  }

  // ===== 級を選ぶ =====
  if (!grade) {
    return (
      <div style={{ marginTop:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
          <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
          <span style={{ color:TEXT.empty, fontSize:'10px' }}>あと{left}セット</span>
        </div>
        <div style={{ color:TEXT.label, fontSize:'11px', marginBottom:'8px' }}>級を選んでください</div>
        <div style={{ display:'grid', gap:'6px' }}>
          {KANJI_GRADES.map(g => {
            const words = kanjiWordsOf(g.key)
            const done = kanjiMasteredCount(log, words)
            const out = left === 0
            return (
              <button key={g.key}
                onClick={() => { setGrade(g.key); setDrill(out); startSet(g.key, out) }}
                style={{ ...cell, textAlign:'left', padding:'9px 10px', fontFamily:'monospace',
                  color:'#cc44ff', cursor:'pointer' }}>
                <div style={{ fontSize:'13px' }}>
                  {g.label}
                  <span style={{ color:TEXT.sub, fontSize:'10px', marginLeft:'10px' }}>
                    1問 {kanjiPt(g.key, 1)}pt ／ {words.length}語
                  </span>
                </div>
                {/* 覚えた語の進み具合。毎日やるほど埋まっていく */}
                <div style={{ display:'flex', alignItems:'center', gap:'6px', marginTop:'5px' }}>
                  <div style={{ ...cell, flex:1, height:'5px' }}>
                    <div style={{ height:'100%', background:'#44ff88',
                      width:`${words.length ? done / words.length * 100 : 0}%` }} />
                  </div>
                  <span style={{ color:'#44ff88', fontSize:'10px' }}>{done}/{words.length}語 覚えた</span>
                </div>
              </button>
            )
          })}
        </div>
        <div style={{ color:TEXT.empty, fontSize:'10px', marginTop:'8px', lineHeight:1.7 }}>
          ※ 上の級ほど1問のptが高くなります。<br />
          ※ <b>1セット{KANJI_SET_SIZE}問</b>です。始めた時点で今日の1セットぶんを使います。
          使い切っても<b>練習だけは続けられます</b>（ptは入りません）。<br />
          ※ <b>間違えた語ほど何度も出ます</b>。3回正解すると「覚えた」に入ります。
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
        {/* ★何問目かをはっきり出す（前は残り数が薄くて見落としていた） */}
        <span style={{ color:'#cfe2ff', fontSize:'13px', fontWeight:'bold' }}>
          {Math.min(inSet, KANJI_SET_SIZE)} / {KANJI_SET_SIZE}問目
        </span>
        <span style={{ color:'#44ff88', fontSize:'11px' }}>{setRight}問 正解</span>
        <span style={{ color: drill ? '#ff8844' : TEXT.empty, fontSize:'10px' }}>
          {drill ? '練習中（ptは入りません）' : `あと${left}セット`}
        </span>
      </div>

      {/* ★1セット終わったときの結果。ここが「終わり」だと分かるようにする */}
      {!quiz && done && (
        <div style={{ ...cell, padding:'14px' }}>
          <div style={{ color:'#44ff88', fontSize:'15px', fontWeight:'bold' }}>
            {drill ? '練習おわり' : 'セット終了'}
          </div>
          <div style={{ color:'#cfe2ff', fontSize:'13px', marginTop:'6px' }}>
            {setRight} / {KANJI_SET_SIZE}問 正解
            {!drill && <span style={{ color:'#44ff88', marginLeft:'10px' }}>INT +{setPt}pt</span>}
          </div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'6px' }}>
            {drill ? '練習はptが入りません。'
              : left > 0 ? `今日はあと${left}セットできます。`
                : '今日のぶんは使い切りました。練習なら続けられます（ptは入りません）。'}
          </div>
          <div style={{ display:'flex', gap:'8px', marginTop:'10px', flexWrap:'wrap' }}>
            {(drill || left > 0) && (
              <button onClick={() => startSet(grade)} style={btn('#cc44ff')}>
                {drill ? 'もう1セット（練習）' : `もう1セット（あと${left}）`}
              </button>
            )}
            {!drill && left === 0 && (
              <button onClick={toDrill} style={btn('#cc44ff')}>練習を続ける</button>
            )}
            <button onClick={onBack} style={btn('#88aaff')}>もどる</button>
          </div>
        </div>
      )}

      {/* 級を選んだ時点で今日のぶんが尽きていたとき */}
      {!quiz && !done && (
        <div style={{ ...cell, padding:'12px' }}>
          <div style={{ color:'#ff8844', fontSize:'11px' }}>今日のぶんは使い切りました。</div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'6px' }}>
            ptは入りませんが、練習は何セットでも続けられます。
          </div>
          <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
            <button onClick={toDrill} style={btn('#cc44ff')}>練習を続ける</button>
            <button onClick={onBack} style={btn('#88aaff')}>もどる</button>
          </div>
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
                {judged.right
                  ? (drill ? '正解！（練習なのでptは入りません）' : `正解！ INT +${judged.pt}pt`)
                  : '不正解'}
              </div>
              <div style={{ color:TEXT.sub, fontSize:'11px', marginTop:'4px' }}>
                {quiz.word}（{quiz.yomi}）
                {/* 間違えた語は濃く出直してくる、と分かるように出しておく */}
                {!judged.right && (
                  <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'8px' }}>
                    この語はまた出ます
                  </span>
                )}
              </div>
              {/* ★セットの中は必ず最後まで進める。区切りは5問目のあとだけ */}
              <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                <button onClick={after} style={btn('#cc44ff')}>
                  {inSet >= KANJI_SET_SIZE ? 'けっかを見る' : `次の問題（${inSet + 1}/${KANJI_SET_SIZE}）`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
