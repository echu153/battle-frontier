import { richSegments, RICH } from '../lib/battleLogRich'

// 戦闘ログの1行（ターンごとのHPバーの行と、スキル名・ダメージなどを色分けした文の行）。
//   旧版の画面（街の出撃・タワー・奈落・八獄・天穹・対人戦・戦争…）と、
//   Ⅱ（V2LogLine → v2cap の V2capLogLine）が同じこの部品で描く。
// ⚠画面のファイル（pages/Game.jsx）の中に戻さない。前は Game.jsx の中にあったので、
//   Ⅱがこれ1つを借りるだけで旧版のホーム画面まるごと（約400KB）を読み込んでいた（2026-10-22）。
//   旧版の画面が今までどおり './Game' から取れるよう、Game.jsx は同じものを export し直している。
export function BattleLogLine({ l }) {
  if (l.type === 'hp') {
    const pPct = Math.max(0, Math.min(100, (l.playerHp / l.playerMax) * 100))
    const ePct = Math.max(0, Math.min(100, (l.enemyHp / l.enemyMax) * 100))
    const statusRow = (list, align) => (
      <div style={{ display:'flex', flexWrap:'wrap', gap:'3px', justifyContent:align, minHeight:'14px', marginBottom:'2px' }}>
        {(list || []).map((s,idx)=>(
          <span key={idx} style={{ fontSize:'9px', color:s.color, background:'#0e1c30', border:'1px solid #244', borderRadius:'3px', padding:'0 3px', whiteSpace:'nowrap' }}>{s.label}</span>
        ))}
      </div>
    )
    // curMp/maxMp を渡すと MP も表示（PvP用。PvEは未指定なので従来どおり非表示）
    const col = (key, name, cur, max, pct, color, status, align, curMp, maxMp) => (
      <div key={key} style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
        {statusRow(status, align)}
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10px', color:'#b8d0e8', gap:'4px' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
          <span style={{ color, flexShrink:0, fontWeight:'bold' }}>{Math.max(0,cur).toLocaleString()} / {max.toLocaleString()}</span>
        </div>
        <div style={{ background:'#13243a', height:'6px', border:'1px solid #2a456a' }}>
          <div style={{ height:'100%', width:`${pct}%`, background:`linear-gradient(90deg,#0a3,${color})` }} />
        </div>
        {maxMp != null && (<>
          <div style={{ display:'flex', justifyContent:'flex-end', fontSize:'9px', color:'#6aa6e0', gap:'4px', marginTop:'1px' }}>
            <span style={{ flexShrink:0 }}>MP {Math.max(0,curMp).toLocaleString()} / {maxMp.toLocaleString()}</span>
          </div>
          <div style={{ background:'#11203a', height:'4px', border:'1px solid #244a6a' }}>
            <div style={{ height:'100%', width:`${Math.max(0,Math.min(100,(curMp/Math.max(1,maxMp))*100))}%`, background:'#3a78d8' }} />
          </div>
        </>)}
      </div>
    )
    // 双子(第3宮)など複数の敵HPバーに対応：l.twin があれば各体を個別のバーで表示
    const enemyCols = Array.isArray(l.twin)
      ? l.twin.map((b, i) => col(`e${i}`, `${b.name}${b.down ? '（蘇生中）' : ''}`, b.hp, b.max, Math.max(0, Math.min(100, (b.hp / b.max) * 100)), b.down ? '#8866aa' : '#ff6655', null, 'flex-end'))
      : col('e', l.enemyName, l.enemyHp, l.enemyMax, ePct, '#ff6655', l.enemyStatus, 'flex-end', l.enemyMp, l.enemyMpMax)
    // ペットは味方側。VSの上（自分の下）に置く
    const petBar = l.petMax == null ? null : (
      <div style={{ marginTop:'4px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'9px', color:'#ffcc66', gap:'4px' }}>
          <span>🐾 ペット{l.petHp <= 0 ? '（戦闘不能）' : ''}</span>
          <span style={{ flexShrink:0, fontWeight:'bold' }}>{Math.max(0,l.petHp).toLocaleString()} / {l.petMax.toLocaleString()}</span>
        </div>
        <div style={{ background:'#2a1f10', height:'5px', border:'1px solid #5a4420' }}>
          <div style={{ height:'100%', width:`${Math.max(0, Math.min(100,(l.petHp/Math.max(1,l.petMax))*100))}%`, background:'linear-gradient(90deg,#a70,#ffaa44)' }} />
        </div>
      </div>
    )
    // 味方と敵の境目。常に真ん中の縦線＋VSで左右に分ける
    const vsMark = (
      <div style={{ flexShrink:0, alignSelf:'stretch', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'2px', padding:'0 1px' }}>
        <div style={{ flex:1, width:'1px', background:'#3a5a80', minHeight:'4px' }} />
        <span style={{ color:'#ffcc66', fontSize:'10px', fontWeight:'bold', letterSpacing:'1px' }}>VS</span>
        <div style={{ flex:1, width:'1px', background:'#3a5a80', minHeight:'4px' }} />
      </div>
    )
    return (
      <div style={{ borderBottom:'1px solid #24405e', padding:'6px 6px', background:'#16263c', borderRadius:'3px', margin:'2px 0' }}>
        <div style={{ fontSize:'9px', color:'#7fa8d0', marginBottom:'3px', textAlign:'center' }}>━ {l.turn}ターン ━</div>
        {/* 味方は左・敵は右。敵が複数のとき(l.vertical)は右側の中で縦に積む。
            上下に分けると誰が味方か分かりにくいので、必ず左右で向かい合わせる */}
        <div style={{ display:'flex', flexDirection:'row', gap:'8px', alignItems: l.vertical ? 'flex-start' : 'flex-end' }}>
          {/* 左右の枠はブロック要素にする。中の col が持つ flex:1 を効かせないことで、
              敵が複数いても味方側のバーが縦に間延びしない */}
          <div style={{ flex:1, minWidth:0 }}>
            {col('p', l.playerName, l.playerHp, l.playerMax, pPct, '#33dd66', l.playerStatus, 'flex-start', l.playerMp, l.playerMpMax)}
            {petBar}
          </div>
          {vsMark}
          <div style={{ flex:1, minWidth:0 }}>
            {Array.isArray(enemyCols)
              ? enemyCols.map((e, i) => <div key={i} style={{ marginTop: i > 0 ? '6px' : 0 }}>{e}</div>)
              : enemyCols}
          </div>
        </div>
      </div>
    )
  }
  // スキル名・ダメージ・回復量・クリティカルだけ色と太さを変えて読みやすくする（味方も敵も同じ規則）
  return (
    <div style={{ color:l.color, fontSize:'12px', lineHeight:'2', borderBottom:'1px solid #001428', padding:'2px 0', textAlign:'left' }}>
      {richSegments(l.text).map((s, i) => s.kind
        ? <span key={i} style={RICH[s.kind]}>{s.text}</span>
        : <span key={i}>{s.text}</span>)}
    </div>
  )
}
