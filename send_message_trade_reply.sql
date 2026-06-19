-- ============================================================
-- トレード機能のお問い合わせへの返信（運営メッセージ）
--   ★ <USERNAME> を実際のユーザー名に置き換えてから実行すること
--   ※ target_player_id 列が未追加なら先に：
--      ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;
-- ============================================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;

-- 問い合わせ(トレード機能)の送信者へ直接返信（player_idで解決＝ユーザー名不要）
INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
SELECT
  '運営からのお知らせ',
$$このたびはお問い合わせいただき、ありがとうございます。管理人のおれおれおです。
いつもバトルフロンティアをプレイいただき、誠にありがとうございます！

お問い合わせいただいたトレード機能についてですが、現在のところご用意できておりません。
今は装備の価値やゲームバランスを調整している段階で、実装まではもう少しお時間をいただく想定です。

せっかくご提案いただいたにもかかわらず、すぐに実装へ移ることができず申し訳ございません。
トレード機能を含め、皆さまに楽しんでいただけるよう開発を進めてまいりますので、また何か気になることがありましたらお気軽にお問い合わせください。

これからもバトルフロンティアをよろしくお願いいたします。$$,
  'update', true, now(), cm.player_id
FROM contact_messages cm
WHERE cm.id = '471ae419-1b16-40ce-b0c6-407cfd2ea1ef'
  AND cm.player_id IS NOT NULL;

-- 確認
SELECT a.id, p.username AS 宛先, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE a.title = '運営からのお知らせ'
ORDER BY a.created_at DESC LIMIT 3;
