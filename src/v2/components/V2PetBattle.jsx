import { useState } from 'react'
import { btn, miniBtn, TEXT } from './v2ui.js'
import { STAT_DEFS } from '../lib/stats.js'
import {
  PET_STAT_KEYS, petsOf, addPet, setActivePet, setPetMoves, evolveAll, PARTY_MAX, MOVE_SLOTS,
} from '../lib/pet.js'
import { speciesOf, knownMoves, familyOf, SPECIES_BY_NAME } from '../lib/petSpecies.js'
import { moveOf } from '../lib/petMoves.js'
import { TYPE_COLOR, typeMult } from '../lib/petTypes.js'
import {
  makeFighter, makeWild, startBattle, battleTurn, battleStatsOf, maxHpOf,
  randomWild, rollCatch,
} from '../lib/petBattle.js'

// ============================================================
// ペットのバトル — 手持ち・技の編成・野生とのバトル
// ------------------------------------------------------------
// ★仕組みの正は src/v2/lib/petBattle.js（純関数）。ここは出すだけ。
//
// ⚠ **他プレイヤーとのバトルはまだ**。育ち具合が端末保存のままだと
//   いくらでも書き換えられるので、サーバーへ移してから。
// ============================================================

const cell = { border:'1px solid #0044aa', background:'#000818' }

// タイプの札
const TypeTag = ({ t }) => (
  <span style={{ border:`1px solid ${TYPE_COLOR[t]}`, color:TYPE_COLOR[t],
    fontSize:'9px', padding:'1px 5px', marginRight:'4px', borderRadius:'2px' }}>{t}</span>
)

const HpBar = ({ hp, max, color = '#44ff88' }) => {
  const r = Math.max(0, Math.min(1, hp / max))
  return (
    <div style={{ ...cell, height:'8px', marginTop:'4px' }}>
      <div style={{ height:'100%', width:`${r * 100}%`,
        background: r > 0.5 ? color : r > 0.2 ? '#ffcc00' : '#ff4444' }} />
    </div>
  )
}

// ============================================================
// 手持ち
// ============================================================
export function PartyPanel({ state, lv, onState, onBack }) {
  const pets = petsOf(state)
  const [pick, setPick] = useState(null)      // 技を編成している位置
  const [msg, setMsg] = useState('')

  // まだ1体もいないとき。3種から選ぶ
  // ★**idを直に書かない**。家系を足し引きすると番号がずれて、
  //   炎・水・草のつもりが全部炎になる（実際そうなっていた）
  const starters = ['ヒノコリス', 'ミズガメ', 'フタバガエル']
    .map(n => SPECIES_BY_NAME[n]).filter(Boolean)

  const take = (id) => {
    const r = addPet(state, id, lv)
    if (!r.ok) { setMsg('手持ちがいっぱいです'); return }
    onState(r.state)
  }

  const evolve = () => {
    const r = evolveAll(state, lv)
    if (!r.evolved.length) { setMsg('いま進化できる子はいません'); return }
    onState(r.state)
    setMsg(r.evolved.map(e => `${e.from}は${e.to}に進化した！`).join(' '))
  }

  if (!pets.length) {
    return (
      <div style={{ marginTop:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
          <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
          <span style={{ color:'#c0b0ff', fontSize:'12px' }}>はじめの1体を選ぶ</span>
        </div>
        <div style={{ display:'grid', gap:'6px' }}>
          {starters.map(sp => {
            return (
              <button key={sp.id} onClick={() => take(sp.id)}
                style={{ ...cell, textAlign:'left', padding:'10px', fontFamily:'monospace',
                  color:'#cfe2ff', cursor:'pointer' }}>
                <div style={{ fontSize:'14px' }}>
                  {sp.name} {sp.types.map(t => <TypeTag key={t} t={t} />)}
                </div>
                <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>
                  {familyOf(sp).map(s => s.name).join(' → ')}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== 技の編成 =====
  if (pick !== null && pets[pick]) {
    const pet = pets[pick]
    const sp = speciesOf(pet.sp)
    const learned = knownMoves(sp, lv)
    const toggle = (name) => {
      const cur = pet.moves || []
      const next = cur.includes(name) ? cur.filter(n => n !== name)
        : cur.length >= MOVE_SLOTS ? cur : [...cur, name]
      onState(setPetMoves(state, pick, next, lv))
    }
    return (
      <div style={{ marginTop:'10px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
          <button onClick={() => setPick(null)} style={miniBtn('#88aaff')}>← 手持ちへ</button>
          <span style={{ color:'#cfe2ff', fontSize:'12px' }}>{sp.name}</span>
          <span style={{ color:TEXT.empty, fontSize:'10px' }}>
            {(pet.moves || []).length}/{MOVE_SLOTS} 技を選ぶ
          </span>
        </div>
        <div style={{ display:'grid', gap:'5px' }}>
          {learned.map(name => {
            const m = moveOf(name)
            const on = (pet.moves || []).includes(name)
            return (
              <button key={name} onClick={() => toggle(name)}
                style={{ ...cell, textAlign:'left', padding:'8px 10px', fontFamily:'monospace',
                  borderColor: on ? '#44ff88' : '#0044aa',
                  color: on ? '#44ff88' : TEXT.body, cursor:'pointer' }}>
                <span style={{ fontSize:'12px' }}>{on ? '● ' : '○ '}{m.name}</span>
                <TypeTag t={m.type} />
                <span style={{ color:TEXT.sub, fontSize:'10px', marginLeft:'6px' }}>
                  {m.kind}{m.pow ? ` 威力${m.pow}` : ''} 命中{m.acc} PP{m.pp}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ===== 一覧 =====
  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#c0b0ff', fontSize:'12px' }}>手持ち {pets.length}/{PARTY_MAX}</span>
        <button onClick={evolve} style={miniBtn('#44ff88')}>進化できるか見る</button>
      </div>
      {msg && <div style={{ color:'#44ff88', fontSize:'11px', marginBottom:'8px' }}>{msg}</div>}

      <div style={{ display:'grid', gap:'6px' }}>
        {pets.map((pet, i) => {
          const sp = speciesOf(pet.sp)
          const stats = battleStatsOf(sp, state.cum)
          const active = (state.active || 0) === i
          return (
            <div key={i} style={{ ...cell, padding:'9px 10px',
              borderColor: active ? '#c0b0ff' : '#0044aa' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                <span style={{ color: active ? '#c0b0ff' : '#cfe2ff', fontSize:'13px' }}>
                  {active ? '🐾 ' : ''}{sp.name}
                </span>
                {sp.types.map(t => <TypeTag key={t} t={t} />)}
                <span style={{ color:TEXT.sub, fontSize:'10px' }}>HP {maxHpOf(stats)}</span>
                {sp.evoTo > 0 && (
                  <span style={{ color:TEXT.empty, fontSize:'10px' }}>
                    LV{sp.evoLv}で進化
                  </span>
                )}
                {sp.stages === 1 && (
                  <span style={{ color:'#ffcc00', fontSize:'10px' }}>進化しない</span>
                )}
              </div>
              <div style={{ color:TEXT.sub, fontSize:'10px', marginTop:'4px' }}>
                {PET_STAT_KEYS.map(k => `${STAT_DEFS[k].label} ${stats[k]}`).join(' ')}
              </div>
              <div style={{ color:TEXT.label, fontSize:'10px', marginTop:'3px' }}>
                技：{(pet.moves || []).join('・') || '—'}
              </div>
              <div style={{ display:'flex', gap:'6px', marginTop:'6px' }}>
                {!active && (
                  <button onClick={() => onState(setActivePet(state, i))} style={miniBtn('#c0b0ff')}>
                    連れていく
                  </button>
                )}
                <button onClick={() => setPick(i)} style={miniBtn('#88ccff')}>技を選ぶ</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 野生とのバトル
// ============================================================
export function WildBattle({ state, lv, onState, onBack }) {
  const pets = petsOf(state)
  const pet = pets[state.active || 0]
  const [battle, setBattle] = useState(null)
  const [result, setResult] = useState(null)

  if (!pet) {
    return (
      <div style={{ marginTop:'10px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <div style={{ color:'#ff8844', fontSize:'11px', marginTop:'8px' }}>
          先に手持ちからペットを選んでください。
        </div>
      </div>
    )
  }

  const start = () => {
    const sp = speciesOf(pet.sp)
    const wildSp = randomWild(lv)
    const me = makeFighter(sp.id, state.cum, pet.moves)
    const foe = makeWild(wildSp.id, state.cum, lv)
    setResult(null)
    setBattle(startBattle(me, foe))
  }

  const use = (name) => {
    if (!battle || battle.over) return
    const next = battleTurn(battle, name)
    setBattle(next)
    if (!next.over) return
    if (!next.win) { setResult({ win: false }); return }
    // 勝った。仲間になるか
    const wildSp = next.foe.sp
    const already = petsOf(state).some(p => p.sp === wildSp.id)
    const caught = rollCatch(wildSp)
    if (caught) {
      const r = addPet(state, wildSp.id, lv)
      if (r.ok) onState(r.state)
      setResult({ win: true, caught: r.ok, full: !r.ok, name: wildSp.name, already })
    } else {
      setResult({ win: true, caught: false, name: wildSp.name, already })
    }
  }

  const Side = ({ f, mine }) => (
    <div style={{ ...cell, padding:'8px', marginBottom:'6px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap' }}>
        <span style={{ color: mine ? '#c0b0ff' : '#ff8844', fontSize:'12px' }}>
          {mine ? '' : '野生の '}{f.name}
        </span>
        {f.sp.types.map(t => <TypeTag key={t} t={t} />)}
        {f.status && <span style={{ color:'#ff4444', fontSize:'10px' }}>{f.status}</span>}
        <span style={{ color:TEXT.sub, fontSize:'10px', marginLeft:'auto' }}>{f.hp}/{f.maxHp}</span>
      </div>
      <HpBar hp={f.hp} max={f.maxHp} color={mine ? '#44ff88' : '#88ccff'} />
    </div>
  )

  return (
    <div style={{ marginTop:'10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'8px' }}>
        <button onClick={onBack} style={miniBtn('#88aaff')}>← もどる</button>
        <span style={{ color:'#c0b0ff', fontSize:'12px' }}>野生とバトル</span>
        {battle && <span style={{ color:TEXT.empty, fontSize:'10px' }}>{battle.turn}ターン目</span>}
      </div>

      {!battle && (
        <div>
          <div style={{ color:TEXT.sub, fontSize:'11px', marginBottom:'8px' }}>
            連れているのは <b style={{ color:'#c0b0ff' }}>{speciesOf(pet.sp).name}</b>。
            勝つと相手が仲間になることがあります。
          </div>
          <button onClick={start} style={btn('#c0b0ff')}>さがす</button>
        </div>
      )}

      {battle && (
        <div>
          <Side f={battle.foe} />
          <Side f={battle.me} mine />

          {/* ログ */}
          <div style={{ ...cell, padding:'8px', minHeight:'70px', marginBottom:'8px' }}>
            {(battle.log.length ? battle.log : ['どうする？']).map((l, i) => (
              <div key={i} style={{ color:TEXT.body, fontSize:'11px', lineHeight:1.7 }}>{l}</div>
            ))}
          </div>

          {!battle.over && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
              {battle.me.moves.map(slot => {
                const m = moveOf(slot.name)
                const mult = m && m.kind !== '変化' ? typeMult(m.type, battle.foe.sp.types) : 1
                const out = slot.pp <= 0
                return (
                  <button key={slot.name} onClick={() => use(slot.name)} disabled={out}
                    style={{ ...cell, padding:'8px', textAlign:'left', fontFamily:'monospace',
                      color: out ? TEXT.empty : '#cfe2ff',
                      cursor: out ? 'not-allowed' : 'pointer' }}>
                    <div style={{ fontSize:'12px' }}>{m?.name || slot.name}</div>
                    <div style={{ fontSize:'9px', marginTop:'3px' }}>
                      <TypeTag t={m?.type || '無'} />
                      <span style={{ color:TEXT.sub }}>PP {slot.pp}</span>
                      {mult > 1 && <span style={{ color:'#44ff88', marginLeft:'6px' }}>抜群</span>}
                      {mult < 1 && mult > 0 && <span style={{ color:'#ff8844', marginLeft:'6px' }}>いまひとつ</span>}
                      {mult === 0 && <span style={{ color:'#ff4444', marginLeft:'6px' }}>効かない</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {battle.over && (
            <div style={{ ...cell, padding:'10px' }}>
              <div style={{ color: battle.win ? '#44ff88' : '#ff8844', fontSize:'13px' }}>
                {battle.win ? '勝った！' : '負けてしまった…'}
              </div>
              {result?.win && (
                <div style={{ color:TEXT.sub, fontSize:'11px', marginTop:'6px', lineHeight:1.7 }}>
                  {result.caught
                    ? `${result.name}が仲間になった！${result.already ? '（同じ種はもういます）' : ''}`
                    : result.full
                      ? '手持ちがいっぱいで仲間にできなかった'
                      : `${result.name}は逃げていった`}
                </div>
              )}
              <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                <button onClick={start} style={btn('#c0b0ff')}>もう一度さがす</button>
                <button onClick={onBack} style={btn('#88aaff')}>もどる</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

