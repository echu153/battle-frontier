import { useEffect, useId, useRef, useState } from 'react'
import { powerOf, statsOf, socketCountOf } from '../lib/equipment.js'
import { STAT_DEFS, STAT_KEYS } from '../lib/stats.js'
import { COLOR_HEX, COLOR_LABEL, runeName } from '../lib/material.js'
import { runePctText } from '../lib/loadout.js'
import { enchantOf } from '../lib/enchant.js'
import { evolutionLines, nextStageAt, TRAIT_BY_KEY } from '../lib/evolve.js'
import { KIND_LABEL, KIND_COLOR, isPassive, powerText } from '../lib/skills.js'
import { RANK_COLOR } from './v2ui.js'

// カーソルを合わせる／タップすると中身が出る小さな枠。
// ・V2Tip      … 入れ物（開閉のふるまいだけ）
// ・V2ItemTip  … 装備の中身（能力値・ソケット・刻印）
// ・V2SkillTip … スキルの効果（威力・消費MP・発動率）
//
// ★スマホ対応（2026-08-16）：カーソルが無いので**タップでも開く**。さらに
//   ・開くのは常に1つだけ（別のを開くと前のは閉じる）
//   ・枠の外をタップすれば閉じる
//   を入れてある。これが無いと、開きっぱなしが積み上がって画面が読めなくなる。

// 開いているものを1つに保つための合図。コンポーネントをまたぐので window で伝える
const TIP_OPEN = 'v2-tip-open'

export function V2Tip({ children, body, alignRight = false, width = '260px', style, color = '#0088ff' }) {
  const id = useId()
  const [show, setShow] = useState(false)
  // ⚠スマホは**タップでも mouseenter 相当が飛ぶ**。素直に書くと
  //   「mouseenter で開く → 直後の click が閉じる」で一瞬しか出ない。
  //   最後に触ったのが指かカーソルかを覚えておいて、指のときだけタップで開閉する。
  const pointer = useRef('mouse')

  useEffect(() => {
    if (!show) return
    // ほかのツールチップが開いたら閉じる
    const onOther = (e) => { if (e.detail !== id) setShow(false) }
    // 枠の外を触ったら閉じる（自分のクリックは stopPropagation で届かない）
    const onOutside = () => setShow(false)
    window.addEventListener(TIP_OPEN, onOther)
    document.addEventListener('click', onOutside)
    return () => {
      window.removeEventListener(TIP_OPEN, onOther)
      document.removeEventListener('click', onOutside)
    }
  }, [show, id])

  const open = () => {
    window.dispatchEvent(new CustomEvent(TIP_OPEN, { detail: id }))
    setShow(true)
  }

  return (
    <span
      onPointerEnter={e => { pointer.current = e.pointerType; if (e.pointerType === 'mouse') open() }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setShow(false) }}
      onClick={e => {
        e.stopPropagation()
        if (pointer.current === 'mouse') { open(); return }   // カーソルは合わせた時点で出ている
        show ? setShow(false) : open()                        // 指はタップで開閉
      }}
      style={{ position:'relative', cursor:'help', ...style }}>
      {children}
      {show && (
        <span style={{ position:'absolute', top:'100%', marginTop:'2px', zIndex:200,
          [alignRight ? 'right' : 'left']: 0, display:'block',
          width, maxWidth:'80vw', textAlign:'left',
          background:'#000c1c', border:`1px solid ${color}`, padding:'8px 10px',
          fontSize:'10px', lineHeight:1.8, color:'#a8c4d6', pointerEvents:'none', whiteSpace:'normal',
          boxShadow:'0 4px 14px rgba(0,0,0,0.75)' }}>
          {body}
        </span>
      )}
    </span>
  )
}

// ===== 装備 =====
// 刻印しているルーンの札。名前が無い（データが古い）ときは色の名前で代用する
export function SealTags({ list, size = '10px' }) {
  if (!(list || []).length) return null
  return (
    <span style={{ fontSize: size }}>
      {list.map(e => (
        <span key={e.id} style={{ color: COLOR_HEX[e.color] }}>
          【{runeName(e.color, e.stats) || COLOR_LABEL[e.color]}】
        </span>
      ))}
    </span>
  )
}

// 進化した武器の見出し。一覧では「⚡見切りの冴え」だけ並べる（値はカーソルで見える）
export function EvoTags({ inv, size = '10px' }) {
  const list = inv?.evolutions || []
  if (!list.length) return null
  return (
    <span style={{ fontSize: size }}>
      {list.map((e, i) => (
        <span key={i} style={{ color:'#ffcc44' }}>⚡{TRAIT_BY_KEY[e.key]?.name || e.key}</span>
      ))}
    </span>
  )
}

// 武器の進化（戦闘記憶）。★ルーンの刻印とは別枠なので、行を分けて出す
export function EvoDetail({ item, inv }) {
  if (item?.part !== '武器') return null
  const rec = inv?.record || {}
  const battles = Number(rec.battles || 0)
  const list = inv?.evolutions || []
  const next = nextStageAt(battles)
  return (
    <div style={{ marginTop:'4px', borderTop:'1px solid #002a55', paddingTop:'4px' }}>
      <span style={{ color:'#7fa6d0' }}>熟練度</span>{' '}
      <span style={{ color:'#cfe2ff' }}>{battles.toLocaleString()}戦</span>
      {next !== null
        ? <span style={{ color:'#62789a' }}>　次の進化まであと{(next - battles).toLocaleString()}戦</span>
        : <span style={{ color:'#62789a' }}>　進化しきった</span>}
      {list.length
        ? list.map((e, i) => (
            <div key={i} style={{ marginTop:'3px' }}>
              <div style={{ color:'#ffcc44' }}>⚡{TRAIT_BY_KEY[e.key]?.name || e.key}</div>
              {/* ★得と代償を色で分ける（代償つきの能力が多いので、ひと目で分かるように） */}
              {evolutionLines(e).map((l, j) => (
                <div key={j} style={{ color: l.cost ? '#ff8866' : '#93a9be', paddingLeft:'12px' }}>
                  {l.cost ? '▼ ' : '▲ '}{l.text}
                </div>
              ))}
            </div>
          ))
        : <div style={{ color:'#62789a' }}>進化なし</div>}
    </div>
  )
}

// 中身（ステータス・ソケット・刻印・武器の進化）
export function ItemDetail({ item, inv, runes }) {
  const plus = inv?.plus || 0
  const st = statsOf(item, plus)
  const sockets = inv?.sockets || []
  const socketMax = socketCountOf(item)
  const pctText = runePctText(runes)
  const abilities = (runes || []).map(e => e.ability).filter(Boolean)
  return (
    <>
      <div>
        <span style={{ color: RANK_COLOR[item.rank] }}>{item.rank}</span>{' '}
        <span style={{ color:'#88ccff' }}>{item.name}</span>
        {plus ? <span style={{ color:'#ffcc00' }}>+{plus}</span> : ''}
        <span style={{ color:'#7fa6d0' }}>　{item.type}　戦闘力{powerOf(item, plus)}</span>
      </div>
      <div style={{ color:'#93a9be' }}>
        {STAT_KEYS.filter(k => st[k]).map(k => `${STAT_DEFS[k].label}+${st[k]}`).join(' / ') || 'ステータス上昇なし'}
      </div>

      {socketMax > 0 && (
        <div style={{ marginTop:'4px' }}>
          <span style={{ color:'#7fa6d0' }}>ソケット</span>{' '}
          {sockets.length
            ? sockets.map((c, i) => <span key={i} style={{ color: COLOR_HEX[c] }}>●</span>)
            : <span style={{ color:'#62789a' }}>—</span>}
          <span style={{ color:'#62789a' }}>　{(runes || []).length}/{socketMax}</span>
        </div>
      )}

      {/* ★刻印しているかどうかはここで分かるようにする */}
      {(runes || []).length > 0 ? (<>
        <div><SealTags list={runes} /></div>
        {pctText && <div style={{ color:'#88ddaa' }}>刻印効果：{pctText}</div>}
        {abilities.map((a, i) => (
          <div key={i} style={{ color:'#ffcc44' }}>
            ★{a}
            {enchantOf(a)?.text && <span style={{ color:'#93a9be' }}>　{enchantOf(a).text}</span>}
          </div>
        ))}
      </>) : socketMax > 0 && (
        <div style={{ color:'#62789a' }}>刻印なし</div>
      )}

      {/* ★武器の進化（戦闘記憶）は刻印とは別枠。ソケットを食わないので分けて出す */}
      <EvoDetail item={item} inv={inv} />
    </>
  )
}

export default function V2ItemTip({ item, inv, runes, alignRight = false, children, style }) {
  if (!item) return children
  return (
    <V2Tip alignRight={alignRight} style={style} body={<ItemDetail item={item} inv={inv} runes={runes} />}>
      {children}
    </V2Tip>
  )
}

// ===== スキル =====
// 消費MPの書き方。割合消費（マナボルト）は「残りMPの20%」
const mpText = (s) => (s.mpPct ? `MP 残りの${Math.round(s.mpPct * 100)}%` : `MP${s.mp}`)

export function SkillDetail({ skill, uses }) {
  const s = skill
  const passive = isPassive(s)
  return (
    <>
      <div>
        <span style={{ color: KIND_COLOR[s.kind] }}>{s.name}</span>
        <span style={{ color:'#7fa6d0' }}>　{KIND_LABEL[s.kind]}　{s.cls}</span>
      </div>
      <div style={{ color:'#93a9be' }}>{s.desc}</div>
      {!passive && (<>
        <div style={{ color:'#88ccff' }}>威力　{powerText(s)}</div>
        <div style={{ color:'#7fa6d0' }}>
          {mpText(s)}　発動率{s.proc}%
          {uses ? `　使用回数×${uses}` : ''}
          {s.priority ? '　先制' : ''}
        </div>
        {/* ★発動率と命中は別の判定。掛け算になるので両方見せる */}
        {s.acc !== undefined && s.acc < 100 && (
          <div style={{ color:'#ffaa66' }}>命中率{s.acc}%（DEXで上がる）</div>
        )}
        {s.sureHit && <div style={{ color:'#44ff88' }}>必ず当たる</div>}
      </>)}
      {passive && <div style={{ color:'#88ddaa' }}>パッシブ（編成すると常に効く）</div>}
    </>
  )
}

export function V2SkillTip({ skill, uses, alignRight = false, children, style }) {
  if (!skill) return children
  return (
    <V2Tip alignRight={alignRight} style={style} width="240px"
      color={KIND_COLOR[skill.kind] || '#0088ff'}
      body={<SkillDetail skill={skill} uses={uses} />}>
      {children}
    </V2Tip>
  )
}
