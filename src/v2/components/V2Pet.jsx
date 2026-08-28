import { useEffect, useRef, useState } from 'react'
import { box, btn, miniBtn, TEXT } from './v2ui.js'
import { STAT_DEFS } from '../lib/stats.js'
import { dayOf } from '../lib/daily.js'
import { loadPref, savePref } from '../lib/prefs.js'
import {
  PET_STAT_KEYS, CONTENTS, CONTENT_BY_KEY,
  emptyPetState, playsLeft, beginPlay, scorePlay, totalPtOf, statsOf, petLvOf, petLvNeed,
  MEMORY_PAIRS, memoryDeck, memoryPt,
  STACK_LIMIT, stackStart, stackStep, stackPt,
  COIN_SIDES, COIN_TOSSES, COIN_CHAIN_FROM, coinFlip, coinPt,
} from '../lib/pet.js'

// ============================================================
// ペット — 遊びと現実の行動で育て、ステータスを主人公に足す
// ------------------------------------------------------------
// いま動くのは**ゲーム内で完結する3つ**（神経衰弱・積み上げ耐久・コイントス）。
// 運動（歩数センサー）と漢字（配当漢字データ）は準備中として枠だけ出す。
//
// ★育ち具合の保存先は端末（localStorage）＝**仮**。
//   ステが主人公に効く以上、最後は必ずサーバーが数える。
//   数え方の正は src/v2/lib/pet.js（サーバーへ移すときもあの形のまま）。
// ============================================================

const PREF_KEY = 'pet'
const cell = { border:'1px solid #0044aa', background:'#000818' }

// ステータス1行
const StatRow = ({ k, value, gain }) => {
  const d = STAT_DEFS[k]
  return (
    <div style={{ display:'flex', alignItems:'baseline', gap:'6px', fontSize:'11px' }}>
      <span style={{ color:d.color, width:'34px' }}>{d.label}</span>
      <span style={{ color:TEXT.bright, width:'40px', textAlign:'right' }}>{value}</span>
      {gain > 0 && <span style={{ color:'#44ff88', fontSize:'10px' }}>+{gain}</span>}
    </div>
  )
}

export default function V2Pet({ onBack }) {
  const [state, setState] = useState(() => ({ ...emptyPetState(), ...loadPref(PREF_KEY, null) }))
  const [game, setGame] = useState('')          // いま開いているミニゲーム
  const [result, setResult] = useState(null)    // 直前のプレイの結果 { label, pts, gains }
  const day = dayOf()

  // ★いまの育ち具合は ref でも持つ。
  //   遊んでいる最中（積み上げのrAFループなど）から呼ばれるので、
  //   render時の値を閉じ込めると古い state に足してしまう
  const stateRef = useRef(state)
  const save = (next) => { stateRef.current = next; savePref(PREF_KEY, next); setState(next) }

  // 遊び始めるときに回数を1つ使う。使い切っていたら false（＝始めさせない）
  const begin = (key) => {
    const r = beginPlay(stateRef.current, key, day)
    if (!r.ok) return false
    save(r.state)
    return true
  }

  // 成績ぶんのptを足す。回数はもう begin で使っている
  const finish = (key, pts, label) => {
    const r = scorePlay(stateRef.current, pts)
    save(r.state)
    setResult({ key, label, pts, gains: r.gains })
  }

  const stats = statsOf(state.cum)
  const total = totalPtOf(state)
  const lv = petLvOf(total)
  const need = petLvNeed(lv + 1)
  const prevNeed = petLvNeed(lv)

  return (
    <div style={{ ...box, padding:'12px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← ホームへ</button>
        <span style={{ color:'#c0b0ff', fontSize:'13px' }}>🐾 ペット</span>
        <span style={{ color:TEXT.label, fontSize:'10px' }}>
          LV{lv}（次のLVまで {Math.max(0, need - total)}pt）
        </span>
      </div>

      <div style={{ color:'#ff8844', fontSize:'10px', marginBottom:'10px', lineHeight:1.7 }}>
        ⚠ 育ち具合はいまこの端末にだけ保存しています（仮）。サーバーへ移すまで、
        別の端末では引き継がれません。
      </div>

      {/* ===== ステータス ===== */}
      <div style={{ ...cell, padding:'8px', marginBottom:'10px' }}>
        <div style={{ color:TEXT.label, fontSize:'10px', marginBottom:'6px' }}>
          ステータス（主人公にこの数字がそのまま足される）
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:'4px' }}>
          {PET_STAT_KEYS.map(k => (
            <StatRow key={k} k={k} value={stats[k]} gain={result?.gains?.[k] || 0} />
          ))}
        </div>
        <div style={{ color:TEXT.empty, fontSize:'9px', marginTop:'6px' }}>
          累計 {total}pt ／ LV{lv}（{prevNeed}〜{need}pt）
        </div>
      </div>

      {/* ===== 遊ぶものを選ぶ ===== */}
      {!game && (
        <div style={{ display:'grid', gap:'6px' }}>
          {CONTENTS.map(c => {
            const left = playsLeft(state, c.key, day)
            const ready = c.key === 'stack' || c.key === 'memory' || c.key === 'coin'
            const out = left === 0
            const color = !ready ? TEXT.empty : out ? TEXT.empty : '#88ccff'
            return (
              <button key={c.key} disabled={!ready || out}
                onClick={() => { setResult(null); setGame(c.key) }}
                style={{ ...cell, textAlign:'left', padding:'9px 10px', color,
                  cursor: (!ready || out) ? 'not-allowed' : 'pointer', fontFamily:'monospace' }}>
                <div style={{ fontSize:'12px' }}>
                  {c.icon} {c.label}
                  <span style={{ color:TEXT.label, fontSize:'10px', marginLeft:'8px' }}>
                    {c.main.map(k => STAT_DEFS[k].label).join('・')}
                  </span>
                  {!ready && <span style={{ color:'#ff8844', fontSize:'10px', marginLeft:'8px' }}>準備中</span>}
                  {/* ★回数の上限がないコンテンツ（運動・漢字）は left が null。
                      そのまま出すと「あとnull回」になるので、量の上限は下の note 側に任せる */}
                  {ready && left !== null && (
                    <span style={{ color: out ? '#ff8844' : '#44ff88', fontSize:'10px', marginLeft:'8px' }}>
                      {out ? '今日はおしまい' : `あと${left}回`}
                    </span>
                  )}
                </div>
                <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'3px' }}>
                  {c.note}（{c.limitText}）
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ===== 直前の結果 ===== */}
      {!game && result && (
        <div style={{ ...cell, padding:'8px', marginTop:'10px' }}>
          <div style={{ color:'#44ff88', fontSize:'11px' }}>
            {CONTENT_BY_KEY[result.key]?.label}：{result.label}
          </div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>
            {Object.entries(result.pts).map(([k, v]) => `${STAT_DEFS[k].label} +${v}pt`).join(' ／ ')}
          </div>
        </div>
      )}

      {game === 'memory' && <MemoryGame onBegin={begin} onDone={finish} onBack={() => setGame('')} />}
      {game === 'stack'  && <StackGame  onBegin={begin} onDone={finish} onBack={() => setGame('')} />}
      {game === 'coin'   && <CoinGame   onBegin={begin} onDone={finish} onBack={() => setGame('')} />}
    </div>
  )
}

// ============================================================
// 神経衰弱 — 手数でDEX・時間でAGI
// ============================================================
function MemoryGame({ onBegin, onDone, onBack }) {
  const [deck] = useState(() => memoryDeck())
  const [open, setOpen] = useState([])        // いまめくっている札の位置（最大2）
  const [done, setDone] = useState([])        // そろった札の位置
  const [moves, setMoves] = useState(0)
  const startAt = useRef(0)   // ★時間を計り始めるのは最初の1枚をめくったとき。
                              //   盤を眺めているあいだをAGIの成績に混ぜない
  const [sec, setSec] = useState(0)
  const [clear, setClear] = useState(null)
  const [started, setStarted] = useState(false)
  const lock = useRef(false)                  // 2枚めくったあとの見せている間は押せない
  const begun = useRef(false)                 // 回数を使ったか（最初の1枚をめくった時点で使う）

  // 経過時間の表示。始まる前と、クリアしたあとは動かさない
  useEffect(() => {
    if (clear || !started) return
    const id = setInterval(() => setSec(Math.floor((Date.now() - startAt.current) / 1000)), 500)
    return () => clearInterval(id)
  }, [started, clear])

  const flip = (i) => {
    if (lock.current || clear) return
    if (open.includes(i) || done.includes(i)) return
    if (!begun.current) {                    // 最初の1枚。ここで今日の1回を使う
      if (!onBegin('memory')) return
      begun.current = true
      startAt.current = Date.now()
      setStarted(true)
    }
    const next = [...open, i]
    setOpen(next)
    if (next.length < 2) return
    setMoves(m => m + 1)
    const [a, b] = next
    if (deck[a] === deck[b]) {
      const nextDone = [...done, a, b]
      setDone(nextDone)
      setOpen([])
      if (nextDone.length === deck.length) {
        const seconds = Math.max(1, Math.round((Date.now() - startAt.current) / 1000))
        const pts = memoryPt({ moves: moves + 1, seconds })
        setClear({ moves: moves + 1, seconds, pts })
        onDone('memory', pts, `${moves + 1}手・${seconds}秒`)
      }
      return
    }
    lock.current = true
    setTimeout(() => { setOpen([]); lock.current = false }, 700)
  }

  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#88ddaa', fontSize:'11px' }}>{moves}手</span>
        <span style={{ color:'#ff8844', fontSize:'11px' }}>{clear ? clear.seconds : sec}秒</span>
        <span style={{ color:TEXT.empty, fontSize:'10px' }}>
          最小{MEMORY_PAIRS}手・25秒で満点
        </span>
      </div>
      <div style={{ color: started ? '#ff8844' : TEXT.empty, fontSize:'10px', marginBottom:'6px' }}>
        {started
          ? '※ 今日の1回を使っています。途中でやめても戻りません'
          : '※ 最初の1枚をめくると今日の1回を使います'}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'5px', maxWidth:'320px' }}>
        {deck.map((n, i) => {
          const shown = open.includes(i) || done.includes(i)
          const matched = done.includes(i)
          return (
            <button key={i} onClick={() => flip(i)} disabled={!!clear}
              style={{ ...cell, height:'58px', fontSize:'20px', fontFamily:'monospace',
                background: matched ? '#002818' : shown ? '#001840' : '#000818',
                borderColor: matched ? '#44ff88' : '#0044aa',
                color: matched ? '#44ff88' : '#cfe2ff',
                cursor: clear ? 'default' : 'pointer' }}>
              {shown ? n : '?'}
            </button>
          )
        })}
      </div>

      {clear && (
        <div style={{ ...cell, padding:'8px', marginTop:'10px' }}>
          <div style={{ color:'#44ff88', fontSize:'12px' }}>
            そろえた！ {clear.moves}手・{clear.seconds}秒
          </div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>
            DEX +{clear.pts.dex}pt ／ AGI +{clear.pts.agi}pt
          </div>
          <button onClick={onBack} style={{ ...btn('#88aaff'), marginTop:'8px' }}>もどる</button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// 積み上げ耐久 — どこまで持ちこたえたかでVIT
// ============================================================
function StackGame({ onBegin, onDone, onBack }) {
  const [view, setView] = useState(() => stackStart())
  const [playing, setPlaying] = useState(false)
  const [over, setOver] = useState(null)
  const sim = useRef(stackStart())
  const input = useRef(0)          // -1 / 0 / +1
  const raf = useRef(0)

  // キーボード（PC）。押しているあいだだけ効く
  useEffect(() => {
    const down = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()          // ★これが無いと舵を切るたびにページが左右へスクロールする
      input.current = e.key === 'ArrowLeft' ? -1 : 1
    }
    const up = (e) => {
      if ((e.key === 'ArrowLeft' && input.current === -1) ||
          (e.key === 'ArrowRight' && input.current === 1)) input.current = 0
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // 進行。崩れた時点で1プレイぶんを記録する
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now) => {
      // タブを離れて飛んだぶんは切る。★下限0も必ず守ること＝
      // dtが負になると Math.pow(DAMP, dt) が増幅側に反転して、1フレームで傾きが発散する
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
      last = now
      sim.current = stackStep(sim.current, dt, input.current)
      setView(sim.current)
      // ★上限なし。崩れるまでが1プレイ＝終わりは崩れたときだけ
      if (sim.current.over) {
        setPlaying(false)
        const blocks = sim.current.blocks
        const pt = stackPt(blocks)
        setOver({ blocks, pt })
        onDone('stack', { vit: pt }, `${blocks}個`)
        return
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // ★始めた時点で今日の1回を使う。崩れそうになったら抜ける、を封じるため
  const start = () => {
    if (!onBegin('stack')) return
    sim.current = stackStart()
    input.current = 0
    setView(sim.current)
    setOver(null)
    setPlaying(true)
  }

  const hold = (dir) => ({
    onMouseDown: () => { input.current = dir },
    onMouseUp:   () => { input.current = 0 },
    onMouseLeave:() => { input.current = 0 },
    onTouchStart:(e) => { e.preventDefault(); input.current = dir },
    onTouchEnd:  (e) => { e.preventDefault(); input.current = 0 },
  })

  const deg = view.tilt * 22
  const fit = Math.min(1, 225 / (view.blocks * 12 + 12))   // 枠(240px)に収まる倍率
  const ratio = Math.min(1, Math.abs(view.tilt) / STACK_LIMIT)

  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#88aaff', fontSize:'11px' }}>{view.blocks}個</span>
        <span style={{ color:TEXT.empty, fontSize:'10px' }}>← → で傾きを戻す</span>
      </div>

      {/* 傾きメーター。端に寄るほど危ない */}
      <div style={{ ...cell, height:'8px', position:'relative', marginBottom:'6px' }}>
        <div style={{ position:'absolute', left:'50%', top:0, bottom:0, width:'1px', background:'#0044aa' }} />
        <div style={{ position:'absolute', top:0, bottom:0, width:'4px',
          left:`calc(${50 + view.tilt * 50}% - 2px)`,
          background: ratio > 0.75 ? '#ff4444' : ratio > 0.5 ? '#ff8844' : '#44ff88' }} />
      </div>

      {/* 塔 */}
      <div style={{ ...cell, height:'240px', display:'flex', alignItems:'flex-end',
        justifyContent:'center', overflow:'hidden' }}>
        {/* ★上限が無いので塔は青天井に伸びる。枠に収まるよう縮めて出す
            （縮めないと上が切れて、いま何個目かが見えなくなる） */}
        <div style={{ transform:`rotate(${deg}deg) scale(${fit})`, transformOrigin:'bottom center',
          display:'flex', flexDirection:'column-reverse', alignItems:'center' }}>
          {Array.from({ length: view.blocks }, (_, i) => (
            <div key={i} style={{ width:`${46 - Math.min(20, i)}px`, height:'11px',
              marginBottom:'1px', background:'#001840', border:'1px solid #88aaff' }} />
          ))}
          <div style={{ width:'64px', height:'6px', background:'#0044aa' }} />
        </div>
      </div>

      {!playing && !over && (
        <div style={{ marginTop:'10px' }}>
          <button onClick={start} style={btn('#88aaff')}>はじめる</button>
          <div style={{ color:TEXT.empty, fontSize:'10px', marginTop:'6px' }}>
            ※ はじめると今日の1回を使います。途中でやめても戻りません
          </div>
        </div>
      )}

      {playing && (
        <div style={{ display:'flex', gap:'8px', marginTop:'10px' }}>
          <button {...hold(-1)} style={{ ...btn('#88aaff'), flex:1, fontSize:'18px' }}>←</button>
          <button {...hold(1)}  style={{ ...btn('#88aaff'), flex:1, fontSize:'18px' }}>→</button>
        </div>
      )}

      {over && (
        <div style={{ ...cell, padding:'8px', marginTop:'10px' }}>
          <div style={{ color:'#ff8844', fontSize:'12px' }}>崩れた！ {over.blocks}個</div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>VIT +{over.pt}pt</div>
          <button onClick={onBack} style={{ ...btn('#88aaff'), marginTop:'8px' }}>もどる</button>
        </div>
      )}
    </div>
  )
}

// ============================================================
// コイントス — 当てるとLUK。3連続からは上乗せ
// ============================================================
// 1回のプレイで COIN_TOSSES 回投げて終わり。回数は最初の1投げで使う
function CoinGame({ onBegin, onDone, onBack }) {
  const [streak, setStreak] = useState(0)
  const [tosses, setTosses] = useState(0)    // 投げた回数
  const [total, setTotal] = useState(0)      // このセットで稼いだpt
  const [hits, setHits] = useState(0)
  const [best, setBest] = useState(0)        // このセットの最高連続
  const [last, setLast] = useState(null)     // { pick, side, hit, pt }
  const [busy, setBusy] = useState(false)
  const begun = useRef(false)
  const done = tosses >= COIN_TOSSES

  const toss = (pick) => {
    if (busy || done) return
    if (!begun.current) {                    // 最初の1投げ。ここで今日の1回を使う
      if (!onBegin('coin')) return
      begun.current = true
    }
    setBusy(true)
    const side = coinFlip()
    const hit = side === pick
    const chain = hit ? streak + 1 : 0
    const pt = coinPt(chain)
    const n = tosses + 1
    const sum = total + pt
    setStreak(chain)
    setBest(b => Math.max(b, chain))
    setHits(h => h + (hit ? 1 : 0))
    setTosses(n)
    setTotal(sum)
    setLast({ pick, side, hit, pt })
    // ★ptを入れるのは投げ切ったとき1回だけ（途中でやめたら入らない）
    if (n >= COIN_TOSSES) {
      onDone('coin', { luk: sum }, `${COIN_TOSSES}投げ中${hits + (hit ? 1 : 0)}回的中`)
    }
    setTimeout(() => setBusy(false), 250)
  }

  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#ffdd66', fontSize:'11px' }}>{tosses}/{COIN_TOSSES}投げ</span>
        <span style={{ color:'#ffdd66', fontSize:'11px' }}>{streak}連続</span>
        <span style={{ color:TEXT.empty, fontSize:'10px' }}>{COIN_CHAIN_FROM}連続から上乗せ</span>
      </div>

      <div style={{ color: begun.current ? '#ff8844' : TEXT.empty, fontSize:'10px', marginBottom:'6px' }}>
        {begun.current
          ? `※ 今日の1回を使っています。${COIN_TOSSES}投げ切るまでptは入りません`
          : `※ 最初の1投げで今日の1回を使います。${COIN_TOSSES}投げで終わりです`}
      </div>

      <div style={{ ...cell, padding:'20px', textAlign:'center', marginBottom:'10px' }}>
        <div style={{ fontSize:'34px', color: last ? (last.hit ? '#44ff88' : '#ff8844') : TEXT.empty }}>
          {last ? last.side : '？'}
        </div>
        <div style={{ color:TEXT.sub, fontSize:'11px', marginTop:'6px' }}>
          {last ? (last.hit ? `当たり！ +${last.pt}pt` : 'はずれ') : '表か裏かを選ぶ'}
        </div>
      </div>

      {!done && (
        <div style={{ display:'flex', gap:'8px' }}>
          {COIN_SIDES.map(s => (
            <button key={s} onClick={() => toss(s)} disabled={busy}
              style={{ ...btn('#ffdd66'), flex:1, fontSize:'16px',
                cursor: busy ? 'not-allowed' : 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {done && (
        <div style={{ ...cell, padding:'8px' }}>
          <div style={{ color:'#44ff88', fontSize:'12px' }}>
            投げ切った！ {COIN_TOSSES}投げ中{hits}回的中（最高{best}連続）
          </div>
          <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>LUK +{total}pt</div>
          <button onClick={onBack} style={{ ...btn('#88aaff'), marginTop:'8px' }}>もどる</button>
        </div>
      )}
    </div>
  )
}
