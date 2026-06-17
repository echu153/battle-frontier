-- ============================================================
-- テストで重複した「運営からのお知らせ」(おれおれお宛)を1件だけ残して削除
--   ※全部消したい場合は下のDELETE(全削除版)を使う
-- ============================================================

-- 確認：おれおれお宛の運営メッセージ
SELECT a.id, a.title, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE p.username = 'おれおれお' AND a.title = '運営からのお知らせ'
ORDER BY a.created_at DESC;

-- 最新1件だけ残して削除
DELETE FROM announcements
WHERE title = '運営からのお知らせ'
  AND target_player_id = (SELECT id FROM profiles WHERE username='おれおれお')
  AND id <> (
    SELECT id FROM announcements
    WHERE title = '運営からのお知らせ'
      AND target_player_id = (SELECT id FROM profiles WHERE username='おれおれお')
    ORDER BY created_at DESC LIMIT 1
  );

-- ▼ テスト分を全部消す場合はこちら（上のDELETEの代わりに）
-- DELETE FROM announcements
-- WHERE title = '運営からのお知らせ'
--   AND target_player_id = (SELECT id FROM profiles WHERE username='おれおれお');
