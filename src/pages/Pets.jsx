import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { SPECIES, STARTERS, SKILLS, MAX_SKILL_SLOTS, SHOP_ITEMS, INV_MAX, petStats, speciesLabel, speciesEmoji, expForLevel, affectionConversion, AFFECTION_MAX, atkLabel, canEvolve, petMaxLevel, evolvedName, petImage, evolvedImage } from '../constants/pets'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
// ペット画像はペットページでアップロードしたものだけを使う（avatars/<uid>/pets/ 配下）

export default function Pets() {
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [pets, setPets] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [uploaded, setUploaded] = useState([])
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [naming, setNaming] = useState(null) // 命名中のスターター種族 {id,label,...}
  const [nick, setNick] = useState('')
  const [periodStart, setPeriodStart] = useState(null) // 現在のスキンシップ時間帯の開始時刻
  const [items, setItems] = useState({}) // 所持アイテム { key: qty }
  const [renaming, setRenaming] = useState(false)
  const [renameInput, setRenameInput] = useState('')

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('id, is_admin, gold').eq('id', user.id).single()
    setProfile(p)
    const { data: list } = await supabase.from('pets').select('*').eq('owner_id', user.id).order('created_at')
    setPets(list || [])
    if (list && list.length && !selectedId) setSelectedId(list.find((x) => x.is_active)?.id || list[0].id)
    const { data: files } = await supabase.storage.from('avatars').list(`${user.id}/pets/`)
    if (files) setUploaded(files.filter((f) => f.name !== '.emptyFolderPlaceholder').map((f) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/pets/${f.name}`))
    const { data: ps } = await supabase.rpc('pet_period_start')
    if (ps) setPeriodStart(ps)
    const { data: its } = await supabase.from('pet_items').select('item_key, qty').eq('owner_id', user.id)
    if (its) setItems(Object.fromEntries(its.map((r) => [r.item_key, r.qty])))
  }

  const buyItem = async (key) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('pet_shop_buy', { p_key: key, p_qty: 1 })
    setLoading(false)
    if (error) {
      const m = String(error.message)
      flash(m.includes('gold') ? 'ゴールドが足りません' : m.includes('inventory') ? `持ち物がいっぱいです（食料は${INV_MAX}個まで）` : '購入失敗: ' + m)
      return
    }
    flash('購入しました')
    await fetchAll()
  }

  const doRename = async () => {
    setLoading(true)
    const { error } = await supabase.rpc('pet_use_rename', { p_pet_id: selectedId, p_name: renameInput })
    setLoading(false)
    if (error) { flash(String(error.message).includes('ticket') ? '変更券がありません' : '変更失敗: ' + error.message); return }
    setRenaming(false); setRenameInput('')
    flash('名前を変更しました')
    await fetchAll()
  }

  // 現在の時間帯(12時間)のスキンシップ残り回数（1回まで／1日2回）
  const skinshipRemaining = (pet) => {
    if (!periodStart || !pet.skinship_period_start) return 1
    const same = new Date(pet.skinship_period_start).getTime() === new Date(periodStart).getTime()
    return same ? Math.max(0, 1 - (pet.skinship_count || 0)) : 1
  }

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const pickStarter = async (sp, name) => {
    setLoading(true)
    const finalName = (name || '').trim() || sp.label
    const { error } = await supabase.from('pets').insert({
      owner_id: profile.id, species: sp.id, name: finalName, level: 1, exp: 0, affection: 0, is_active: true,
    })
    setLoading(false)
    if (error) { flash('作成に失敗: ' + error.message); return }
    setNaming(null)
    flash(`${finalName} を仲間にした！`)
    await fetchAll()
  }

  const setActive = async (pet) => {
    setLoading(true)
    // 部分ユニーク制約のため、まず全部 false にしてから対象を true
    await supabase.from('pets').update({ is_active: false }).eq('owner_id', profile.id)
    await supabase.from('pets').update({ is_active: true }).eq('id', pet.id)
    setLoading(false)
    flash(`${pet.name} を選択した`)
    await fetchAll()
  }

  const doEvolve = async (pet) => {
    const next = evolvedName(pet)
    if (!window.confirm(`${pet.name}（${speciesLabel(pet)}）を ${next} に進化させます。\n進化すると現在ステータスが1.5倍になり、以降はレベル100まで成長量が2倍になります。よろしいですか？`)) return
    setLoading(true)
    const { error } = await supabase.rpc('pet_evolve', { p_pet_id: pet.id })
    if (!error) {
      // 進化したら画像を進化後イラストに差し替える（カスタム画像も上書き。その後また変更可）
      const evoImg = evolvedImage(pet)
      if (evoImg) await supabase.from('pets').update({ image_url: evoImg }).eq('id', pet.id)
    }
    setLoading(false)
    if (error) { flash('進化に失敗: ' + error.message); return }
    flash(`✨ ${pet.name} は ${next} に進化した！`)
    await fetchAll()
  }

  const doSkinship = async (pet) => {
    setLoading(true)
    const { data, error } = await supabase.rpc('pet_skinship', { p_pet_id: pet.id })
    setLoading(false)
    if (error) {
      if (String(error.message).includes('limit')) flash('この時間帯はもうスキンシップ済み（5:00 / 17:00 にリセット）')
      else flash('失敗: ' + error.message)
      return
    }
    flash(`${pet.name} と触れ合った！ なつき+1（この時間帯あと${data.remaining}回）`)
    await fetchAll()
  }

  const setImage = async (url) => {
    if (!selectedId) return
    setLoading(true)
    await supabase.from('pets').update({ image_url: url }).eq('id', selectedId)
    setLoading(false)
    flash('画像を設定した')
    await fetchAll()
  }

  const toggleSlot = async (skillId) => {
    if (!selectedId) return
    if (SKILLS[skillId]?.fixed) return // たいあたりは固定装備（外せない）
    const slots = Array.isArray(selected.skill_slots) ? selected.skill_slots : ['tackle']
    let next
    if (slots.includes(skillId)) {
      if (slots.length <= 1) { flash('スキルは最低1つ必要です'); return }
      next = slots.filter((s) => s !== skillId)
    } else {
      if (slots.length >= MAX_SKILL_SLOTS) { flash(`持っていけるスキルは最大${MAX_SKILL_SLOTS}つまで`); return }
      next = [...slots, skillId]
    }
    setLoading(true)
    await supabase.from('pets').update({ skill_slots: next }).eq('id', selectedId)
    setLoading(false)
    await fetchAll()
  }

  const uploadImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setLoading(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/pets/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (error) { flash('アップロード失敗'); setLoading(false); return }
    const url = `${SUPABASE_URL}/storage/v1/object/public/avatars/${path}`
    await supabase.from('pets').update({ image_url: url }).eq('id', selectedId)
    setLoading(false)
    flash('画像をアップロードして設定した')
    await fetchAll()
  }

  if (!profile || pets === null) return <Center>読み込み中...</Center>

  // スターター未所持
  if (pets.length === 0) {
    // 命名ステップ
    if (naming) {
      const st = petStats({ species: naming.id, level: 1 })
      return (
        <Wrap nav={nav} msg={msg}>
          <h3 style={{ color: '#aa88ff', margin: '12px 0' }}>名前をつけよう</h3>
          <div style={{ border: '1px solid #335588', background: '#001026', padding: 16, textAlign: 'center' }}>
            {naming.image ? <img src={naming.image} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ fontSize: 56 }}>{naming.emoji}</div>}
            <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>{naming.label}　HP{st.maxHp} / {atkLabel(naming)}{st.atk} / 防{st.def} / 特防{st.mdef}</div>
            <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={12} placeholder={naming.label}
              style={{ width: '70%', padding: 8, margin: '10px 0', background: '#000818', border: '1px solid #335588', color: '#cce6ff', fontFamily: 'monospace', textAlign: 'center', fontSize: 14 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6 }}>
              <Btn onClick={() => { setNaming(null); setNick('') }}>もどる</Btn>
              <Btn onClick={() => !loading && pickStarter(naming, nick)}>この名前で決定</Btn>
            </div>
          </div>
        </Wrap>
      )
    }
    return (
      <Wrap nav={nav} msg={msg}>
        <h3 style={{ color: '#aa88ff', margin: '12px 0' }}>最初の相棒を選ぼう</h3>
        <div style={{ color: '#5588bb', fontSize: 12, marginBottom: 12 }}>1体だけ選べます。他の種族は今後「卵」で入手できます。</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {STARTERS.map((sp) => {
            const st = petStats({ species: sp.id, level: 1 })
            return (
              <div key={sp.id} style={{ border: '1px solid #335588', background: '#001026', padding: 10, textAlign: 'center' }}>
                {sp.image ? <img src={sp.image} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} /> : <div style={{ fontSize: 40 }}>{sp.emoji}</div>}
                <div style={{ color: '#cce6ff', marginTop: 4 }}>{sp.label}</div>
                <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>HP{st.maxHp} / {atkLabel({ species: sp.id })}{st.atk} / 防{st.def} / 特防{st.mdef}</div>
                <Btn onClick={() => { setNaming(sp); setNick(sp.label) }}>選ぶ</Btn>
              </div>
            )
          })}
        </div>
      </Wrap>
    )
  }

  const selected = pets.find((p) => p.id === selectedId) || pets[0]
  const sst = petStats(selected)
  const need = expForLevel(selected.level)
  const conv = Math.round(affectionConversion(selected.affection) * 100)

  return (
    <Wrap nav={nav} msg={msg}>
      {/* 所持一覧 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 14 }}>
        {pets.map((p) => (
          <div key={p.id} onClick={() => setSelectedId(p.id)}
            style={{ border: `2px solid ${p.id === selected.id ? '#aa88ff' : '#224466'}`, background: p.is_active ? '#101a30' : '#000a18', padding: 6, textAlign: 'center', cursor: 'pointer', position: 'relative' }}>
            {p.is_active && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 9, color: '#44ff88' }}>選択中</span>}
            <Portrait pet={p} size={44} />
            <div style={{ color: '#cce6ff', fontSize: 11, marginTop: 2 }}>{p.name}</div>
            <div style={{ color: '#6699cc', fontSize: 10 }}>Lv{p.level}</div>
          </div>
        ))}
      </div>

      {/* 選択中ペット詳細 */}
      <div style={{ border: '1px solid #335588', background: '#00102a', padding: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Portrait pet={selected} size={64} />
          <div style={{ flex: 1 }}>
            <div style={{ color: '#cce6ff', fontSize: 15 }}>{selected.name} <span style={{ color: selected.evolved ? '#ffcc66' : '#6699cc', fontSize: 11 }}>({speciesLabel(selected)}{selected.evolved ? '・進化' : ''})</span></div>
            <div style={{ color: '#88bbee', fontSize: 12, marginTop: 4 }}>Lv{selected.level}/{petMaxLevel(selected)}　HP{sst.maxHp} / {atkLabel(selected)}{sst.atk} / 防{sst.def} / 特防{sst.mdef}</div>
            <div style={{ color: '#6699cc', fontSize: 11, marginTop: 2 }}>EXP {selected.exp} / {need}</div>
            <div style={{ color: '#ffaacc', fontSize: 11, marginTop: 2 }}>なつき {selected.affection}/{AFFECTION_MAX}（ステータス変換 +{conv}%）</div>
          </div>
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {skinshipRemaining(selected) > 0
            ? <Btn onClick={() => !loading && doSkinship(selected)}>🤲 スキンシップ（なつき+1・あと{skinshipRemaining(selected)}回）</Btn>
            : <span style={{ background: '#0a0f1a', border: '1px solid #223344', color: '#556677', padding: '6px 12px', fontSize: 12 }}>🤲 スキンシップ済み</span>}
          {!selected.is_active && <Btn onClick={() => !loading && setActive(selected)}>このペットを選択する</Btn>}
          {canEvolve(selected) && <Btn onClick={() => !loading && doEvolve(selected)}>✨ 進化させる（→{evolvedName(selected)}）</Btn>}
          {(items.rename || 0) > 0 && !renaming && <Btn onClick={() => { setRenaming(true); setRenameInput(selected.name) }}>🎫 ニックネーム変更券で改名（{items.rename}枚）</Btn>}
        </div>
        {renaming && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={renameInput} onChange={(e) => setRenameInput(e.target.value)} maxLength={12} placeholder={selected.name}
              style={{ padding: 6, background: '#000818', border: '1px solid #335588', color: '#cce6ff', fontFamily: 'monospace', fontSize: 13 }} />
            <Btn onClick={() => !loading && doRename()}>券を使って変更</Btn>
            <Btn onClick={() => { setRenaming(false); setRenameInput('') }}>やめる</Btn>
          </div>
        )}
        <div style={{ color: '#557799', fontSize: 10, marginTop: 4 }}>※スキンシップは1日2回（5:00 / 17:00 にリセット）</div>

        {/* スキル（ダンジョンに持っていくスキルを最大4つ選ぶ） */}
        <div style={{ marginTop: 12, borderTop: '1px solid #223a55', paddingTop: 10 }}>
          <div style={{ color: '#aa88ff', fontSize: 12, marginBottom: 6 }}>
            持っていくスキル（たいあたり固定＋{MAX_SKILL_SLOTS - 1}つ）　{(selected.skill_slots || ['tackle']).length}/{MAX_SKILL_SLOTS}
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(SKILLS).map(([id, sk]) => {
              const learned = sk.learnLv <= selected.level
              const carried = (selected.skill_slots || ['tackle']).includes(id) || sk.fixed
              const clickable = learned && !sk.fixed
              return (
                <div key={id} onClick={() => clickable && !loading && toggleSlot(id)}
                  style={{ border: `1px solid ${carried ? '#aa88ff' : '#224466'}`, background: carried ? '#170f2a' : '#000a18', padding: '6px 8px', cursor: clickable ? 'pointer' : 'default', opacity: learned ? 1 : 0.45 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: learned ? '#cce6ff' : '#667788' }}>
                    <span>{carried ? '✓ ' : ''}{sk.name} <span style={{ fontSize: 10, color: '#ffaa66' }}>{sk.cost > 0 ? `満腹${sk.cost}` : '消費なし'}</span></span>
                    <span style={{ fontSize: 10, color: learned ? (carried ? '#aa88ff' : '#6699cc') : '#aa6644' }}>{sk.fixed ? '固定装備' : learned ? (carried ? '装備中' : '装備する') : `Lv${sk.learnLv}で習得`}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#5e7fa0', marginTop: 2 }}>{sk.desc}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 画像設定（ペットページでアップロードした画像のみ） */}
      <div style={{ color: '#aa88ff', fontSize: 13, marginBottom: 6 }}>画像を設定（{selected.name}）</div>
      {uploaded.length === 0
        ? <div style={{ color: '#557799', fontSize: 11, marginBottom: 8 }}>まだ画像がありません。下のボタンからアップロードできます。</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 6, marginBottom: 8 }}>
            {uploaded.map((url) => (
              <img key={url} src={url} alt="" onClick={() => !loading && setImage(url)}
                style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', border: `2px solid ${selected.image_url === url ? '#aa88ff' : '#224466'}`, cursor: 'pointer' }} />
            ))}
          </div>
        )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ color: '#88ccff', fontSize: 12, border: '1px solid #0088ff', padding: '6px 10px', cursor: 'pointer' }}>
          画像をアップロード<input type="file" accept="image/*" onChange={uploadImage} style={{ display: 'none' }} />
        </label>
        {selected.image_url && <Btn onClick={() => !loading && setImage(null)}>画像をはずす</Btn>}
      </div>

      {/* ペット商店 */}
      <div style={{ marginTop: 20, borderTop: '1px solid #335588', paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: '#ffcc44', fontSize: 14 }}>🛒 ペット商店</div>
          <div style={{ color: '#ffd866', fontSize: 12 }}>所持G: {profile.gold?.toLocaleString?.() ?? profile.gold}</div>
        </div>
        <div style={{ color: '#5e7fa0', fontSize: 10, marginBottom: 6 }}>※食料などの持ち物は合計{INV_MAX}個まで（だっしゅつの翼は対象外）　食料 {items.onigiri || 0}/{INV_MAX}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {SHOP_ITEMS.map((it) => (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #224466', background: '#000a18', padding: 8 }}>
              <div style={{ fontSize: 26 }}>{it.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#cce6ff', fontSize: 13 }}>{it.name} <span style={{ color: '#6699cc', fontSize: 10 }}>所持{items[it.key] || 0}</span></div>
                <div style={{ color: '#5e7fa0', fontSize: 10 }}>{it.desc}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#ffd866', fontSize: 12, marginBottom: 4 }}>{it.price.toLocaleString()}G</div>
                <Btn onClick={() => !loading && buyItem(it.key)}>購入</Btn>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Wrap>
  )
}

function Portrait({ pet, size }) {
  const src = petImage(pet) // カスタム画像 or 種族デフォ（進化で切替）
  if (src) return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4 }} />
  return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.7 }}>{speciesEmoji(pet)}</div>
}

function Wrap({ children, nav, msg }) {
  return (
    <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', padding: 16 }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ color: '#aa88ff', letterSpacing: 2 }}>🐾 ペット <span style={{ fontSize: 11, color: '#4466aa' }}>[開発中]</span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn onClick={() => nav('/dungeon')}>🕳 ダンジョン</Btn>
            <Btn onClick={() => nav('/game')}>🏰 街</Btn>
          </div>
        </div>
        {msg && <div style={{ background: '#101a30', border: '1px solid #335588', color: '#aaddff', padding: 8, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
        {children}
      </div>
    </div>
  )
}
function Center({ children }) {
  return <div style={{ minHeight: '100vh', background: '#000820', color: '#88ccff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
}
function Btn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: '#001840', border: '1px solid #0088ff', color: '#0088ff', padding: '6px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12 }}>{children}</button>
}
