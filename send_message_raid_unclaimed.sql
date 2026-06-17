-- ============================================================
-- 個別プレイヤーへの運営メッセージ（お知らせの宛先指定機能）
--   announcements に target_player_id を追加。
--   null=全体向け（従来通り）、特定id=そのプレイヤーだけに表示。
--   クライアントは「全体＋自分宛」のみ取得するよう対応済み。
-- ============================================================

-- 1) 宛先列を追加（既にあれば何もしない）
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;

-- 2) 対象2名へ「運営からのお知らせ」を送信
--    雨摩座(2026-06-17)の報酬未受取者: ku6ro / いものこじる
INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
SELECT
  '運営からのお知らせ',
$$いつもプレイいただきありがとうございます。運営です。

本日のレイドボス「雨摩座」討伐の報酬が、不具合により受け取れない状態になっていたことを確認しました。大変申し訳ありません。

修正を行い、レイドボスの画面を開くと上部に「🎁 未受取のレイド報酬があります」欄が表示されるようになりました。そちらの「受け取る」ボタンから受け取ってください。
（表示されない場合はページを一度再読み込みしてからお試しください）

ご迷惑をおかけして申し訳ありませんでした。今後ともよろしくお願いいたします。$$,
  'update', true, now(), p.id
FROM profiles p
WHERE p.username IN ('ku6ro', 'いものこじる');

-- 確認: 送信された宛先付きお知らせ
SELECT a.id, a.title, p.username AS 宛先, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE a.title = '運営からのお知らせ'
ORDER BY a.created_at DESC;
