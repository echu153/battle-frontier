-- ============================================================
-- いものこじる へ運営メッセージ送信（雨摩座 報酬未受取の案内＋別件）
--   ※ target_player_id 列が未追加なら先に：
--      ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;
-- ============================================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;

INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
SELECT
  '運営からのお知らせ',
$$このたびは、お問い合わせいただくお手数をおかけし、恐れ入ります。管理人のおれおれおです。
ゲームをプレイいただきありがとうございます！

本日のレイドボス「雨摩座」討伐の報酬が、不具合により受け取れない状態になっていたことを確認しました。大変申し訳ありません。

修正を行い、レイドボスの画面を開くと上部に「🎁 未受取のレイド報酬があります」欄が表示されるようになりました。そちらの「受け取る」ボタンから受け取ってください。
レイドボスの画面へは、メニューから移動できます。
（表示されない場合はページを一度再読み込みしてからお試しください）
もし受け取れない場合には、お手数ですがあらためてお問い合わせいただけますでしょうか。

あと別件ですが、ボタン修正するの忘れてました。お箸さんに良い感じに直してとお伝えください。

ご迷惑をおかけして申し訳ありませんでした。今後ともよろしくお願いいたします。$$,
  'update', true, now(), p.id
FROM profiles p
WHERE p.username = 'いものこじる';

-- 確認
SELECT a.id, p.username AS 宛先, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE a.title = '運営からのお知らせ' AND p.username = 'いものこじる';
