-- ============================================================
-- 【テスト送信】運営メッセージを「おれおれお」だけに送る
--   表示確認用。問題なければ本番(ku6ro/いものこじる)へ送る。
--   ※ target_player_id 列が未追加なら先に：
--      ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;
-- ============================================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;

INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
SELECT
  '運営からのお知らせ',
$$いつもプレイいただきありがとうございます。運営です。

本日のレイドボス「雨摩座」討伐の報酬が、不具合により受け取れない状態になっていたことを確認しました。大変申し訳ありません。

修正を行い、レイドボスの画面を開くと上部に「🎁 未受取のレイド報酬があります」欄が表示されるようになりました。そちらの「受け取る」ボタンから受け取ってください。
レイドボスの画面へは、メニューから移動できます。
（表示されない場合はページを一度再読み込みしてからお試しください）

ご迷惑をおかけして申し訳ありませんでした。今後ともよろしくお願いいたします。$$,
  'update', true, now(), p.id
FROM profiles p
WHERE p.username = 'おれおれお';

-- 確認
SELECT a.id, a.title, p.username AS 宛先, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE a.title = '運営からのお知らせ' ORDER BY a.created_at DESC;

-- テスト削除用（確認後に消す場合）:
-- DELETE FROM announcements WHERE title='運営からのお知らせ'
--   AND target_player_id = (SELECT id FROM profiles WHERE username='おれおれお');
