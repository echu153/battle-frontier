import { useEffect, useMemo, useState } from 'react'
import { box, miniBtn, TEXT } from './v2ui.js'
import { runBattle } from '../core/battle.js'
import { RARITY_COLOR, kindLabel, UNIQUE_ITEMS } from '../lib/equipment.js'
import { toFighter, wornUniquesOf } from '../lib/loadout.js'
import { checkUnique, FOE } from '../lib/uniqueCheck.js'
import { buildCapBattleView } from '../lib/battleView.js'
import { CAP_RULES } from '../lib/rules.js'
import { UniqueText } from './V2capUniqueFx.jsx'
import V2capLogLine from './V2capLogLine.jsx'

// ============================================================
// 「レベルキャップあり」版 — ユニークの固有の能力が発動するかの確かめ［開発］（2026-10-21）
//   ユーザー「一旦今のままで実装して、効果がすべて発動するかも実機確認して」
//   ・60個ぜんぶ：uniqueCheck.js（テストと同じもの）をこの画面で走らせ、能力の項目ごとに ✓／✗ と中身を出す
//     （本物の戦闘エンジン・乱数は「いつも当たる」「いつも外れる」に固定＝毎回同じ結果）
//   ・いまの装備で木人と戦う：着けているユニークの能力が、ふだんの戦闘のログに出るか（ふだんと同じ乱数・10ターン）
// ============================================================
const U = RARITY_COLOR.U
const OK = '#44ff88'
const NG = '#ff5566'

export default function V2capUniqueCheck({ prof, inventory }) {
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const [only, setOnly] = useState(false)
  const [log, setLog] = useState(null)

  // 1つずつ（画面が固まらないように、1つ終わるたびに描き直す）
  const runAll = () => {
    setRunning(true); setResults([])
    let i = 0
    const out = []
    const step = () => {
      if (i >= UNIQUE_ITEMS.length) { setRunning(false); return }
      out.push(checkUnique(UNIQUE_ITEMS[i]))
      i += 1
      setResults([...out])
      setTimeout(step, 0)
    }
    step()
  }
  useEffect(() => { runAll() }, [])

  const okN = results.filter(r => r.ok).length
  const shown = only ? results.filter(r => !r.ok) : results
  const worn = useMemo(() => wornUniquesOf(prof, inventory), [prof, inventory])

  // いまの装備（プロフィールと持ち物そのまま）で木人と10ターン戦う
  const spar = () => {
    const me = toFighter(prof, inventory)
    const dummy = { name: FOE, cls: '剣士', kind: 'phys', ...CAP_RULES, slots: [], passives: [],
      stats: { hp: 999999, mp: 100, str: Math.max(30, Math.round((me.stats.vit || 0) * 0.8)), dex: 120, agi: 80, int_stat: 60, vit: 120, luk: 40 } }
    const r = runBattle(me, dummy, { maxTurns: 10 })
    const lines = r.log.filter(l => (l.type === 'uniqueAct' || l.type === 'uniqueFx') || (l.name && worn.some(u => (l.name || '').includes(u.name))))
    setLog({ view: buildCapBattleView(r, me.name, FOE), n: lines.length, names: [...new Set(lines.map(l => l.name).filter(Boolean))], me: me.name })
  }

  return (
    <div style={{ fontFamily:'monospace', display:'grid', gap:'10px' }}>
      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: U, fontSize:'12px', marginBottom:'6px' }}>💎 60個の固有の能力（本物の戦闘エンジンで確かめる）</div>
        <div style={{ fontSize:'11px', color: TEXT.sub, lineHeight:1.7, marginBottom:'8px' }}>
          能力の項目ごとに、その能力だけを抜いた装備と比べたり、戦闘のログに出るかを見ます。乱数は「いつも当たる」「いつも外れる」に固定しているので、毎回同じ結果になります。
        </div>
        <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', fontSize:'12px' }}>
          <span>発動を確認：<b style={{ color: okN === UNIQUE_ITEMS.length ? OK : NG }}>{okN}</b> / {UNIQUE_ITEMS.length}{running ? '（確かめ中…）' : ''}</span>
          <button onClick={runAll} disabled={running} style={miniBtn('#ff88cc')}>もう一度</button>
          <button onClick={() => setOnly(v => !v)} style={miniBtn(only ? NG : '#62789a')}>{only ? '全部を出す' : '✗だけ出す'}</button>
          <button onClick={() => setOpen(new Set(open.size ? [] : results.map(r => r.item.id)))} style={miniBtn('#62789a')}>{open.size ? 'たたむ' : '全部ひらく'}</button>
        </div>
      </div>

      <div style={{ ...box, padding:'10px', display:'grid', gap:'3px' }}>
        {shown.map(r => {
          const isOpen = open.has(r.item.id)
          return (
            <div key={r.item.id} style={{ background:'#000818', border:`1px solid ${r.ok ? '#002244' : NG}`, padding:'5px 8px' }}>
              <button onClick={() => setOpen(s => { const n = new Set(s); n.has(r.item.id) ? n.delete(r.item.id) : n.add(r.item.id); return n })}
                style={{ all:'unset', cursor:'pointer', display:'flex', gap:'6px', alignItems:'baseline', width:'100%', fontSize:'12px', flexWrap:'wrap' }}>
                <span style={{ color: r.ok ? OK : NG, width:'14px' }}>{r.ok ? '✓' : '✗'}</span>
                <span style={{ color: U }}>{r.item.name}</span>
                <span style={{ color: TEXT.label, fontSize:'10px' }}>{kindLabel(r.item)}・{r.item.boss}</span>
                <span style={{ color: TEXT.sub, fontSize:'10px', marginLeft:'auto' }}>{r.checks.filter(c => c.ok).length}/{r.checks.length}</span>
              </button>
              {isOpen && (
                <div style={{ fontSize:'10px', marginTop:'4px', paddingLeft:'20px', display:'grid', gap:'2px' }}>
                  <UniqueText item={r.item} style={{ marginBottom:'2px' }} />
                  {r.checks.map(c => (
                    <div key={c.key} style={{ color: c.ok ? '#cfe2ff' : NG }}>
                      <span style={{ color: c.ok ? OK : NG }}>{c.ok ? '✓' : '✗'}</span> {c.label}：{c.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ ...box, padding:'12px' }}>
        <div style={{ color: U, fontSize:'12px', marginBottom:'6px' }}>⚔ いまの装備で木人と戦う</div>
        <div style={{ fontSize:'11px', color: TEXT.sub, lineHeight:1.7, marginBottom:'8px' }}>
          着けているユニーク：{worn.length ? worn.map(u => <span key={u.id} style={{ color: U, marginRight:'6px' }}>{u.name}</span>) : 'なし（装備の画面で着けてから）'}
          <br />ふだんの出撃と同じ組み立て（プロフィール・持ち物・スキル編成）で、HPのとても多い木人と10ターン戦います（経験値や装備は入りません）。
        </div>
        <button onClick={spar} style={miniBtn('#ff88cc')}>戦う</button>
        {log && (
          <div style={{ marginTop:'8px' }}>
            <div style={{ fontSize:'11px', marginBottom:'4px', color: log.n > 0 ? OK : TEXT.sub }}>
              ユニークの能力の行：{log.n}行{log.names.length ? `（${log.names.join('・')}）` : ''}
            </div>
            <div style={{ maxHeight:'420px', overflowY:'auto', background:'#000818', padding:'6px' }}>
              {/* 表の名前は art から出る（絵は無いので名前の1文字目の枠） */}
              {log.view.map((l, i) => <V2capLogLine key={i} l={l} art={{ me: { src: null, name: log.me }, foe: { src: null, name: FOE } }} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
