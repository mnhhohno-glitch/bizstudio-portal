import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // Find admin user
  const adminResult = await pool.query(
    "SELECT id, name FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1"
  );
  if (adminResult.rows.length === 0) {
    console.log("No admin user found");
    return;
  }
  const admin = adminResult.rows[0];
  console.log("Admin:", admin.id, admin.name);

  const id = crypto.randomBytes(12).toString("base64url");
  const now = new Date();

  const title = "エントリーレコードの編集機能を追加しました";
  const content =
    "エントリー管理画面（/entries）の各エントリーレコードを、モーダルで直接編集できるようになりました。\n\n" +
    "【主な用途】\n" +
    "・Circusなど求人DB連携時に企業名へ求人タイトルが混入してしまったケースの修復\n" +
    "・紹介日・書類提出日の日付訂正\n" +
    "・メモの追記・修正\n\n" +
    "【操作方法】\n" +
    "各行の右端、メモアイコンの左に鉛筆アイコン（✏️）が追加されました。\n" +
    "クリックすると編集モーダルが開き、以下のフィールドをまとめて編集できます。\n\n" +
    "【編集できる項目】\n" +
    "・企業名（必須）\n" +
    "・求人タイトル\n" +
    "・求人DB（必須）／求人種別\n" +
    "・求人ID\n" +
    "・紹介日（必須）／書類提出日\n" +
    "・メモ\n\n" +
    "求人DBを切り替えると求人種別の選択肢が自動で連動します（Circus／マイナビJOB／HITO-Link）。\n\n" +
    "【補足】\n" +
    "既存のインライン編集（エントリーフラグ・フラグ詳細・企業対応・本人対応）はそのまま使えます。行内で素早く変更したい場合はインライン、複数項目をまとめて修正したい場合はモーダルをお使いください。\n\n" +
    "引き当て直しの手間を省き、データ修復を効率化する目的で追加しました。";

  const publishedAt = new Date("2026-04-17T00:00:00.000Z");

  const result = await pool.query(
    `INSERT INTO announcements (id, title, content, category, status, published_at, author_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, title`,
    [id, title, content, "FEATURE", "PUBLISHED", publishedAt, admin.id, now, now]
  );

  console.log("Created announcement:", result.rows[0].id, result.rows[0].title);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
