-- ============================================================
-- スロット：AT中はベットを消費しない（commit d6a959f の巻き戻し）
--  - AT分岐で at_bet を徴収していた処理を削除
--  - ナビ成功時の払い出し（at_bet×1.5）は据え置き
--  - 適用順序の制約なし（クライアントと前後どちらでも安全）
-- ============================================================
CREATE OR REPLACE FUNCTION public.slot_spin(bet integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  uid UUID := auth.uid(); cur_medals INTEGER; st RECORD;
  max_bet INTEGER := 1000; min_bet INTEGER := 10;
  weights INTEGER[] := ARRAY[1,2,4,6,6,7]; total INTEGER := 26;
  reels INTEGER[] := ARRAY[0,0,0];
  i INTEGER; r INTEGER; acc INTEGER; s INTEGER;
  payout INTEGER := 0; mult NUMERIC := 0;
  use_bet INTEGER; v_mode TEXT; v_at INTEGER; v_cz INTEGER;
  at_entered BOOLEAN := false; cz_entered BOOLEAN := false;
  cz_rate NUMERIC := 0.03; cz_len INTEGER := 5; at_len INTEGER := 30;
  nav INTEGER[] := NULL;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '未認証です'; END IF;
  SELECT * INTO st FROM slot_state WHERE player_id = uid FOR UPDATE;
  IF st IS NULL THEN INSERT INTO slot_state(player_id) VALUES (uid); SELECT * INTO st FROM slot_state WHERE player_id = uid; END IF;
  v_mode := st.mode; v_at := st.at_games; v_cz := st.cz_games;

  IF st.at_pending THEN
    IF v_mode='cz' THEN
      v_cz := v_cz - 1;
      IF v_cz <= 0 THEN v_mode:='normal'; UPDATE slot_state SET mode='normal', cz_games=0, at_bet=0, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      ELSE UPDATE slot_state SET cz_games=v_cz, at_pending=false, pend_nav=NULL WHERE player_id=uid; END IF;
    ELSIF v_mode='at' THEN
      v_at := v_at - 1;
      IF v_at <= 0 THEN v_mode:='normal'; UPDATE slot_state SET mode='normal', at_games=0, at_bet=0, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      ELSE UPDATE slot_state SET at_games=v_at, at_pending=false, pend_nav=NULL WHERE player_id=uid; END IF;
    END IF;
  END IF;

  IF v_mode = 'cz' THEN
    reels := ARRAY[2,2,2];
    SELECT array_agg(x ORDER BY random()) INTO nav FROM unnest(ARRAY[0,1,2]) AS t(x);
    UPDATE slot_state SET at_pending=true, pend_nav=nav WHERE player_id=uid;
    SELECT medals INTO cur_medals FROM profiles WHERE id = uid;
    RETURN json_build_object('kind','cz','reels',reels,'nav',nav,'pending',true,'mode','cz','cz_games',v_cz,'medals',cur_medals);
  ELSIF v_mode = 'at' THEN
    -- ★AT中はベットを消費しない（ナビ成功で at_bet×1.5 を払い出し）
    use_bet := st.at_bet;
    SELECT medals INTO cur_medals FROM profiles WHERE id = uid;
    reels := ARRAY[2,2,2];
    SELECT array_agg(x ORDER BY random()) INTO nav FROM unnest(ARRAY[0,1,2]) AS t(x);
    UPDATE slot_state SET at_pending=true, pend_nav=nav, pend_payout=floor(use_bet*1.5) WHERE player_id=uid;
    RETURN json_build_object('kind','at','reels',reels,'nav',nav,'pending',true,'mode','at','at_games',v_at,'bet',use_bet,'medals',cur_medals);
  ELSE
    use_bet := bet;
    IF use_bet IS NULL OR use_bet < min_bet THEN RAISE EXCEPTION 'ベットは10メダルからです'; END IF;
    IF use_bet > max_bet THEN RAISE EXCEPTION 'ベット上限を超えています'; END IF;
    SELECT medals INTO cur_medals FROM profiles WHERE id = uid FOR UPDATE;
    IF cur_medals < use_bet THEN RAISE EXCEPTION 'メダルが足りません'; END IF;
    FOR i IN 1..3 LOOP
      r := floor(random()*total); acc := 0;
      FOR s IN 0..5 LOOP acc := acc + weights[s+1]; IF r < acc THEN reels[i] := s; EXIT; END IF; END LOOP;
    END LOOP;
    IF reels[1]=reels[2] AND reels[2]=reels[3] THEN
      mult := CASE reels[1] WHEN 0 THEN 250 WHEN 1 THEN 60 WHEN 2 THEN 25 WHEN 3 THEN 16 WHEN 4 THEN 12 WHEN 5 THEN 12 ELSE 0 END;
      IF reels[1]=0 THEN at_entered := true; END IF;
    ELSIF reels[1]=4 THEN mult := 1; END IF;
    payout := floor(use_bet*mult);
    IF at_entered THEN
      v_mode:='at'; v_at:=at_len;
      UPDATE slot_state SET mode='at', at_games=at_len, at_bet=use_bet WHERE player_id=uid;
    ELSIF random() < cz_rate THEN
      cz_entered := true; v_mode:='cz'; v_cz:=cz_len;
      UPDATE slot_state SET mode='cz', cz_games=cz_len, at_bet=use_bet WHERE player_id=uid;
    END IF;
    PERFORM set_config('app.allow_medals','on',true);
    UPDATE profiles SET medals = medals - use_bet + payout WHERE id = uid;
    RETURN json_build_object('kind','normal','reels',reels,'mult',mult,'payout',payout,'bet',use_bet,
      'mode',v_mode,'at_games',v_at,'cz_games',v_cz,'at_entered',at_entered,'cz_entered',cz_entered,'medals',cur_medals-use_bet+payout);
  END IF;
END;
$function$;
