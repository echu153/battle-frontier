-- ============================================================
-- 運営メッセージ送信：双極盤(オセロ)対局のお誘い
--   宛先: 箸 / いものこじる / もん@ の3名（個別宛＝target_player_id）
--   ※ target_player_id 列が未追加なら先に ALTER（下記に含む）
-- ============================================================
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS target_player_id uuid;

INSERT INTO announcements (title, content, category, is_active, created_at, target_player_id)
SELECT
  '運営からのお知らせ',
$$お疲れ様です。
娯楽の「双極盤」でオセロが遊べるようになりました。
記念に、7/18 21時のレイド完了後、もん@さんとオセロの勝負を行います。

＠もんさんは、オセロをする時間がある場合はレイドにご参加いただきますようお願いいたします。
観戦機能もありますので、お二方も時間があればぜひ観戦してみてください。

なお、＠もんさんがレイドの参加を忘れても、21:30までは部屋を立てておきます。

当日はよろしくお願いいたします。$$,
  'update', true, now(), p.id
FROM profiles p
WHERE p.username IN ('箸', 'いものこじる', 'もん@');

-- 確認（3名すべてに届いたか＝3行出れば成功。名前が違うと行が欠けます）
SELECT p.username AS 宛先, a.created_at
FROM announcements a JOIN profiles p ON p.id = a.target_player_id
WHERE a.title = '運営からのお知らせ'
  AND p.username IN ('箸', 'いものこじる', 'もん@')
ORDER BY a.created_at DESC;
