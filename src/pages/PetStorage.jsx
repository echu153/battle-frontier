import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { PET_ITEMS, bagCapacity, petItemImg } from '../constants/pets'

// ダンジョンに持っていける（持ち物へ移せる）アイテム
const DUNGEON_KEYS = new Set(['escape', 'onigiri', 'konomi'])

export default function PetStorage() {
  const nav = useNavigate()
  const [allowed, setAllowed] = useState(null)
  const [storage, setStorage] = useState({}) // 倉庫 { key: qty }
  const [items, setItems] = useState({})     // 持ち物 { key: qty }
  const [sel, setSel] = useState({})         // 選択個数 { key: n }
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [bagMax, setBagMax] = useState(bagCapacity(0))

  useEffect(() => { fetchAll() }, [])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('id').eq('id', user.id).single()
    if (!p) { nav('/game'); return }
    setAllowed(true)
    const { data: sto } = await supabase.from('pet_storage').select('item_key, qty').eq('owner_id', user.id)
    setStorage(Object.fromEntries((sto || []).map((r) => [r.item_key, r.qty])))
    const { data: its } = await supabase.from('pet_items').select('item_key, qty').eq('owner_id', user.id)
    setItems(Object.fromEntries((its || []).map((r) => [r.item_key, r.qty])))
    // 袋容量 = 10 + 10×(クリア済みダンジョン種類数)
    const { data: runs } = await supabase.from('dungeon_runs').select('dungeon_id').eq('owner_id', user.id).eq('cleared', true)
    const clearedKinds = new Set((runs || []).map((r) => r.dungeon_id)).size
    setBagMax(bagCapacity(clearedKinds))
  }

  const setQty = (key, n, max) => {
    const v = Math.max(1, Math.min(max, n || 1))
    setSel((s) => ({ ...s, [key]: v }))
  }

  const move = async (key, toBag, max) => {
    const qty = Math.max(1, Math.min(max, sel[key] || 1))
    setLoading(true)
    const { error } = await supabase.rpc('pet_storage_move', { p_key: key, p_qty: qty, p_to_bag: toBag })
    setLoading(false)
    if (error) {
      const m = String(error.message)
      flash(m.includes('bag full') ? `持ち物がいっぱいです（合計${bagMax}個まで）` : m.includes('no item') ? '在庫がありません' : '移動失敗: ' + m)
      return
    }
    setSel((s) => ({ ...s, [key]: 1 }))
    flash(toBag ? `持ち物に${qty}個 移しました` : `倉庫に${qty}個 戻しました`)
    await fetchAll()
  }

  if (allowed === null) return <Center>読み込み中...</Center>

  const bagTotal = Object.values(items).reduce((s, q) => s + (q || 0), 0)
  const storeKeys = Object.keys(storage).filter((k) => (storage[k] || 0) > 0)
  const bagKeys = Object.keys(items).filter((k) => (items[k] || 0) > 0)

  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #003366', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ color: '#66aaff', fontSize: 16, letterSpacing: 2 }}>🏬 倉庫</div>
          <Btn onClick={() => nav('/pets')}>← ペットに戻る</Btn>
        </div>

        {msg && <div style={{ background: '#101a30', border: '1px solid #335588', color: '#aaddff', padding: 8, fontSize: 12, marginBottom: 10, textAlign: 'center' }}>{msg}</div>}

        <div style={{ color: '#5e7fa0', fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
          購入したアイテムやダンジョンの戦利品はここに預かります。ダンジョンで使う物（翼・木の実・おにぎり）は「→持ち物」で移してから潜ってください。<br />
          持ち物 <span style={{ color: '#aaddff' }}>{bagTotal}/{bagMax}</span><span style={{ color: '#5e7fa0' }}>　※ダンジョンを初めて踏破するごとに上限+10</span>
        </div>

        {/* 倉庫の中身 */}
        <div style={{ color: '#88aacc', fontSize: 12, marginBottom: 6 }}>📦 倉庫の中身</div>
        <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
          {storeKeys.length === 0
            ? <span style={{ color: '#445566', fontSize: 12 }}>（空）</span>
            : storeKeys.map((k) => {
                const max = storage[k]
                const isDungeon = DUNGEON_KEYS.has(k)
                return (
                  <ItemRow key={k} k={k} qty={max}>
                    {isDungeon
                      ? <QtyMove sel={sel[k] || 1} max={max} loading={loading}
                          onSet={(n) => setQty(k, n, max)} onMove={() => move(k, true, max)} label="→持ち物" />
                      : <span style={{ color: '#5e7fa0', fontSize: 10 }}>{k.endsWith('_seed') ? 'チャーム強化で使用' : 'ここで使用'}</span>}
                  </ItemRow>
                )
              })}
        </div>

        {/* 持ち物 */}
        <div style={{ color: '#88aacc', fontSize: 12, marginBottom: 6 }}>🎒 持ち物（ダンジョンに持っていく）</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {bagKeys.length === 0
            ? <span style={{ color: '#445566', fontSize: 12 }}>（空）</span>
            : bagKeys.map((k) => {
                const max = items[k]
                return (
                  <ItemRow key={k} k={k} qty={max}>
                    <QtyMove sel={sel[k] || 1} max={max} loading={loading}
                      onSet={(n) => setQty(k, n, max)} onMove={() => move(k, false, max)} label="→倉庫" />
                  </ItemRow>
                )
              })}
        </div>
      </div>
    </div>
  )
}

function ItemRow({ k, qty, children }) {
  const def = PET_ITEMS[k]
  const img = petItemImg(k)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #224466', background: '#000a18', padding: '8px 10px' }}>
      {img ? <img src={img} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} /> : <span style={{ fontSize: 20 }}>{def?.emoji || '🔹'}</span>}
      <span style={{ flex: 1, color: '#cce6ff', fontSize: 13 }}>{def?.name || k} <span style={{ color: '#6699cc', fontSize: 11 }}>×{qty}</span></span>
      {children}
    </div>
  )
}

// 個数選択＋移動ボタン
function QtyMove({ sel, max, loading, onSet, onMove, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button disabled={loading} onClick={() => onSet(sel - 1)} style={qtyBtn}>−</button>
      <input value={sel} onChange={(e) => onSet(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 1)}
        style={{ width: 36, textAlign: 'center', background: '#000a18', border: '1px solid #335588', color: '#cce6ff', fontFamily: 'monospace', fontSize: 12, padding: '2px 0' }} />
      <button disabled={loading} onClick={() => onSet(sel + 1)} style={qtyBtn}>＋</button>
      <button disabled={loading} onClick={() => onSet(max)} style={{ ...qtyBtn, width: 'auto', padding: '0 6px', fontSize: 10 }}>MAX</button>
      <Btn onClick={onMove}>{label}</Btn>
    </div>
  )
}

function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}
function Btn({ children, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 10px', cursor: disabled ? 'default' : 'pointer', fontFamily: 'monospace', fontSize: 12, opacity: disabled ? 0.5 : 1 }}>{children}</button>
}
const qtyBtn = { background: '#001028', border: '1px solid #335588', color: '#88bbee', width: 24, height: 24, cursor: 'pointer', fontFamily: 'monospace', fontSize: 14, lineHeight: '20px', padding: 0 }
