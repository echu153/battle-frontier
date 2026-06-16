-- パピアをLv50・未進化にして進化テストできるようにする
-- ※ evolved 列を使うには先に supabase_pet_evolve.sql を実行しておくこと
update pets
set level = 50,
    exp = 0,
    evolved = false
where name = 'パピア';

-- 確認用
select id, name, species, level, exp, evolved from pets where name = 'パピア';
