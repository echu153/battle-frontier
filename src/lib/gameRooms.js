import { supabase } from '../supabase'

// 娯楽の部屋一覧をDBにも保存する(耐久層)。
//   Realtimeのpresenceはホストの通信が切れた瞬間に消えるため、部屋が一覧から
//   丸ごと消える。DB側は90秒の猶予があるので、瞬断中でも部屋が見つかる。
//   ※supabase_game_rooms.sql が未適用でも、全て黙って失敗してpresenceだけで動く。

export async function publishRoomDb(game, room, status, meta = {}) {
  if (!room?.id) return
  try {
    await supabase.rpc('upsert_game_room', {
      p_room_id: room.id,
      p_game: game,
      p_title: room.title || '',
      p_host_name: room.hostName || '',
      p_status: status === 'playing' ? 'playing' : 'waiting',
      p_meta: meta,
    })
  } catch { /* SQL未適用/通信失敗でもpresenceで動くので無視 */ }
}

export async function closeRoomDb(roomId) {
  if (!roomId) return
  try {
    await supabase.rpc('close_game_room', { p_room_id: roomId })
  } catch { /* 無視 */ }
}

// 一覧をpresence形式({ roomId, title, hostId, hostName, status, count, ...meta })に揃えて返す
export async function listRoomsDb(game) {
  try {
    const { data, error } = await supabase.rpc('list_game_rooms', { p_game: game })
    if (error || !Array.isArray(data)) return []
    return data.map((r) => ({
      roomId: r.room_id,
      title: r.title,
      hostId: r.host_id,
      hostName: r.host_name,
      status: r.status,
      count: 1,
      ...(r.meta || {}),
      fromDb: true,
    }))
  } catch {
    return []
  }
}

// presence(即時・確実に生きている)を優先しつつ、DBにしか無い部屋も表示する
export function mergeRooms(presenceRooms, dbRooms) {
  const byId = new Map()
  for (const r of dbRooms || []) if (r?.roomId) byId.set(r.roomId, r)
  for (const r of presenceRooms || []) if (r?.roomId) byId.set(r.roomId, r)
  return [...byId.values()]
}
