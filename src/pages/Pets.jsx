import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import { SPECIES, STARTERS, petStats, speciesLabel, speciesEmoji, expForLevel, affectionConversion, AFFECTION_MAX } from '../constants/pets'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const PRESET_IMAGES = [
  'warrior1', 'knight1', 'samurai', 'hunter1', 'hunter2', 'wizard1', 'wizard2', 'priest',
].map((id) => ({ id, url: `${SUPABASE_URL}/storage/v1/object/public/avatars/${id}.png` }))

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

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { nav('/login'); return }
    const { data: p } = await supabase.from('profiles').select('id, is_admin, gold').eq('id', user.id).single()
    setProfile(p)
    const { data: list } = await supabase.from('pets').select('*').eq('owner_id', user.id).order('created_at')
    setPets(list || [])
    if (list && list.length && !selectedId) setSelectedId(list.find((x) => x.is_active)?.id || list[0].id)
    const { data: files } = await supabase.storage.from('avatars').list(`${user.id}/`)
    if (files) setUploaded(files.map((f) => `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}/${f.name}`))
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

  const setImage = async (url) => {
    if (!selectedId) return
    setLoading(true)
    await supabase.from('pets').update({ image_url: url }).eq('id', selectedId)
    setLoading(false)
    flash('画像を設定した')
    await fetchAll()
  }

  const uploadImage = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setLoading(true)
    const ext = file.name.split('.').pop()
    const path = `${profile.id}/${Date.now()}.${ext}`
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
            <div style={{ fontSize: 56 }}>{naming.emoji}</div>
            <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>{naming.label}　HP{st.maxHp} / 攻{st.atk} / 守{st.def}</div>
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
                <div style={{ fontSize: 40 }}>{sp.emoji}</div>
                <div style={{ color: '#cce6ff', marginTop: 4 }}>{sp.label}</div>
                <div style={{ color: '#6699cc', fontSize: 11, margin: '6px 0' }}>HP{st.maxHp} / 攻{st.atk} / 守{st.def}</div>
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
  const need = expForLevel(selected.level + 1)
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
            <div style={{ color: '#cce6ff', fontSize: 15 }}>{selected.name} <span style={{ color: '#6699cc', fontSize: 11 }}>({speciesLabel(selected)})</span></div>
            <div style={{ color: '#88bbee', fontSize: 12, marginTop: 4 }}>Lv{selected.level}　HP{sst.maxHp} / 攻{sst.atk} / 守{sst.def}</div>
            <div style={{ color: '#6699cc', fontSize: 11, marginTop: 2 }}>EXP {selected.exp} / {need}</div>
            <div style={{ color: '#ffaacc', fontSize: 11, marginTop: 2 }}>なつき {selected.affection}/{AFFECTION_MAX}（ステータス変換 +{conv}%）</div>
          </div>
        </div>
        {!selected.is_active && <div style={{ marginTop: 10 }}><Btn onClick={() => !loading && setActive(selected)}>このペットを選択する</Btn></div>}
      </div>

      {/* 画像設定 */}
      <div style={{ color: '#aa88ff', fontSize: 13, marginBottom: 6 }}>画像を設定（{selected.name}）</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(48px, 1fr))', gap: 6, marginBottom: 8 }}>
        {[...PRESET_IMAGES.map((x) => x.url), ...uploaded].map((url) => (
          <img key={url} src={url} alt="" onClick={() => !loading && setImage(url)}
            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', border: `2px solid ${selected.image_url === url ? '#aa88ff' : '#224466'}`, cursor: 'pointer' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ color: '#88ccff', fontSize: 12, border: '1px solid #0088ff', padding: '6px 10px', cursor: 'pointer' }}>
          画像をアップロード<input type="file" accept="image/*" onChange={uploadImage} style={{ display: 'none' }} />
        </label>
        {selected.image_url && <Btn onClick={() => !loading && setImage(null)}>画像をはずす</Btn>}
      </div>
    </Wrap>
  )
}

function Portrait({ pet, size }) {
  if (pet.image_url) return <img src={pet.image_url} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4 }} />
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
