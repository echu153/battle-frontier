-- ============================================================
-- スロット調整（この1本でOK。supabase_slot_at_nobet.sql を置き換え）
--  ① AT中はベットを消費しない（slot_spin のAT分岐の徴収を削除）
--  ② CZ中のAT当選率を 5% → 10% に（slot_at_resolve の cz_win_rate）
--  ※ ナビ成功時の払い出し(at_bet×1.5)・上乗せ等は据え置き
-- ============================================================

-- ① slot_spin：AT中は徴収しない
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


-- ② slot_at_resolve：CZ中のAT当選率を 10% に
CREATE OR REPLACE FUNCTION public.slot_at_resolve(press_order integer[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  uid UUID := auth.uid(); st RECORD; cur_medals INTEGER;
  success BOOLEAN; payout INTEGER := 0; bonus INTEGER := 0; total_grant INTEGER;
  v_at INTEGER; v_cz INTEGER;
  cz_win_rate NUMERIC := 0.10; toku_base NUMERIC := 0.03; toku_rate NUMERIC;  -- ★CZ中AT当選率 0.05→0.10
  at_won BOOLEAN := false; toku_trig BOOLEAN := false;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION '未認証です'; END IF;
  SELECT * INTO st FROM slot_state WHERE player_id = uid FOR UPDATE;
  IF st IS NULL OR NOT st.at_pending THEN RAISE EXCEPTION '解決待ちのゲームがありません'; END IF;
  success := (press_order = st.pend_nav);

  IF st.mode = 'cz' THEN
    v_cz := st.cz_games - 1;
    IF success AND random() < cz_win_rate THEN at_won := true; END IF;
    IF at_won THEN
      UPDATE slot_state SET mode='at', at_games=30, cz_games=0, toku_count=0, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      RETURN json_build_object('kind','cz','success',success,'at_won',true,'mode','at','at_games',30,'cz_games',0);
    ELSIF v_cz <= 0 THEN
      UPDATE slot_state SET mode='normal', cz_games=0, at_bet=0, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      RETURN json_build_object('kind','cz','success',success,'at_won',false,'mode','normal','cz_games',0);
    ELSE
      UPDATE slot_state SET cz_games=v_cz, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      RETURN json_build_object('kind','cz','success',success,'at_won',false,'mode','cz','cz_games',v_cz);
    END IF;
  ELSE
    IF success THEN payout := st.pend_payout; END IF;
    v_at := st.at_games - 1;
    toku_rate := toku_base * power(0.5, st.toku_count);
    IF success AND random() < toku_rate THEN toku_trig := true; END IF;
    IF toku_trig THEN
      v_at := v_at + 5;
      bonus := st.at_bet * 10;
    END IF;
    total_grant := payout + bonus;
    SELECT medals INTO cur_medals FROM profiles WHERE id = uid FOR UPDATE;
    IF total_grant > 0 THEN
      PERFORM set_config('app.allow_medals','on',true);
      UPDATE profiles SET medals = medals + total_grant WHERE id = uid;
    END IF;
    IF v_at <= 0 THEN
      UPDATE slot_state SET mode='normal', at_games=0, at_bet=0, toku_count=0, at_pending=false, pend_nav=NULL WHERE player_id=uid;
      RETURN json_build_object('kind','at','success',success,'payout',payout,'bonus',bonus,'added',(CASE WHEN toku_trig THEN 5 ELSE 0 END),'toku_triggered',toku_trig,'mode','normal','at_games',0,'medals',cur_medals+total_grant);
    ELSE
      UPDATE slot_state SET at_games=v_at, toku_count = st.toku_count + (CASE WHEN toku_trig THEN 1 ELSE 0 END), at_pending=false, pend_nav=NULL WHERE player_id=uid;
      RETURN json_build_object('kind','at','success',success,'payout',payout,'bonus',bonus,'added',(CASE WHEN toku_trig THEN 5 ELSE 0 END),'toku_triggered',toku_trig,'mode','at','at_games',v_at,'medals',cur_medals+total_grant);
    END IF;
  END IF;
END;
$function$;
