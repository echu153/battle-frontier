import { useState } from 'react'
import { powerOf, statsOf, socketCountOf } from '../lib/equipment.js'
import { STAT_DEFS, STAT_KEYS } from '../lib/stats.js'
import { COLOR_HEX, COLOR_LABEL, runeName } from '../lib/material.js'
import { runePctText } from '../lib/loadout.js'
import { enchantOf } from '../lib/enchant.js'
import { RANK_COLOR } from './v2ui.js'

// 装備の中身をまとめて出すための部品。
// ・sealTags   … 刻印しているルーンを【鋭牙】【疾風】の形で出す（一覧の行に添える用）
// ・V2ItemTip  … カーソルを合わせる／タップすると、ステータスと刻印を出す枠
// ★「ソケットの色（●●）」と「実際に刻印しているか」は別もの。
//   色だけだと空きソケットと見分けが付かないので、刻印は必ず【】で名前を出す。

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

// 中身（ステータス・ソケット・刻印）。枠の中に置く用
export function ItemDetail({ item, inv, runes }) {
  const plus = inv?.plus || 0
  const st = statsOf(item, plus)
  const sockets = inv?.sockets || []
  const socketMax = socketCountOf(item)
  const pctText = runePctText(runes)
  const abilities = (runes || []).map(e => e.ability).filter(Boolean)
  return (
    <div style={{ lineHeight:1.8 }}>
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
        {pctText && (
          <div style={{ color:'#88ddaa' }}>刻印効果：{pctText}</div>
        )}
        {abilities.map((a, i) => (
          <div key={i} style={{ color:'#ffcc44' }}>
            ★{a}
            {enchantOf(a)?.text && <span style={{ color:'#93a9be' }}>　{enchantOf(a).text}</span>}
          </div>
        ))}
      </>) : socketMax > 0 && (
        <div style={{ color:'#62789a' }}>刻印なし</div>
      )}
    </div>
  )
}

// カーソルを合わせる／タップすると中身が出る包み。
// ★スマホはカーソルが無いのでタップでも出す。ほかを触れば閉じる。
export default function V2ItemTip({ item, inv, runes, alignRight = false, children, style }) {
  const [show, setShow] = useState(false)
  if (!item) return children
  return (
    <span
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={() => setShow(v => !v)}
      style={{ position:'relative', cursor:'help', ...style }}>
      {children}
      {show && (
        <span style={{ position:'absolute', top:'100%', marginTop:'2px', zIndex:200,
          [alignRight ? 'right' : 'left']: 0, display:'block',
          width:'260px', maxWidth:'80vw', textAlign:'left',
          background:'#000c1c', border:'1px solid #0088ff', padding:'8px 10px',
          fontSize:'10px', color:'#a8c4d6', pointerEvents:'none', whiteSpace:'normal',
          boxShadow:'0 4px 14px rgba(0,0,0,0.75)' }}>
          <ItemDetail item={item} inv={inv} runes={runes} />
        </span>
      )}
    </span>
  )
}
