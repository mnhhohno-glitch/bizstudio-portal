-- T-064: ScoutMachineMaster に aliases カラムを追加（recruiterName のスペース揺れ・RPA号機表記吸収用）
ALTER TABLE "scout_machine_masters" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] NOT NULL DEFAULT '{}';

-- 既存マスタへエイリアス投入
-- 1号機 = 藤本 なつみ
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 1号機', 'RPA1号機', 'RPA-1号機', '1号機']
  WHERE "recruiter_name" = '藤本 なつみ';

-- 2号機 = 岡田 かなこ
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 2号機', 'RPA2号機', 'RPA-2号機', '2号機']
  WHERE "recruiter_name" = '岡田 かなこ';

-- 3号機 = 上原 ちはる
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 3号機', 'RPA3号機', 'RPA-3号機', '3号機']
  WHERE "recruiter_name" = '上原 ちはる';

-- 4号機 = 上原 千遥
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 4号機', 'RPA4号機', 'RPA-4号機', '4号機']
  WHERE "recruiter_name" = '上原 千遥';

-- 5号機 = 岡田 愛子
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 5号機', 'RPA5号機', 'RPA-5号機', '5号機']
  WHERE "recruiter_name" = '岡田 愛子';

-- 6号機 = 安藤 嘉富（停止中）
UPDATE "scout_machine_masters" SET "aliases" = ARRAY['RPA 6号機', 'RPA6号機', 'RPA-6号機', '6号機']
  WHERE "recruiter_name" = '安藤 嘉富';
