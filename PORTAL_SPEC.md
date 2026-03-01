# BizStudio Portal 仕様書

## 1. 認証

### 認証ライブラリ
独自実装（NextAuth/Auth.js不使用）

### 認証方式
Credentials認証（メールアドレス + パスワード）

### セッション管理方式
Cookie-based Session
- Cookie名: `bs_session`
- 有効期限: 7日間
- 設定: `httpOnly`, `secure`（本番環境）, `sameSite: lax`

### middleware.ts
middleware.ts は存在しない。認証チェックは以下で実施：
- `src/app/(app)/layout.tsx`: `getSessionUser()` で認証チェック、未認証時は `/login` へリダイレクト
- 各APIルート: `getSessionUser()` を呼び出して認証・認可チェック

### Userモデルのスキーマ

| フィールド | 型 | 説明 |
|-----------|-----|------|
| id | String | CUID |
| name | String | ユーザー名 |
| email | String | メールアドレス（ユニーク） |
| passwordHash | String | bcryptハッシュ化パスワード |
| role | UserRole | ロール |
| status | UserStatus | ステータス |
| manusApiKeyEncrypted | String? | ManusAPIキー（AES-256-GCM暗号化） |
| manusApiKeySetAt | DateTime? | ManusAPIキー設定日時 |
| createdAt | DateTime | 作成日時 |
| updatedAt | DateTime | 更新日時 |

### ロール定義

| ロール | 説明 |
|--------|------|
| admin | 管理者（全機能アクセス可） |
| member | 一般メンバー（閲覧・基本機能のみ） |

---

## 2. デプロイ構成

### ホスティング先
Railway

### 本番URL
https://bizstudio-portal-production.up.railway.app（推定）

### データベース
PostgreSQL（Railway Postgres）
- 接続方式: 外部ネットワーク経由（プロキシURL使用）
- ホスト: `trolley.proxy.rlwy.net`

### 環境変数一覧

| 変数名 | 用途 |
|--------|------|
| DATABASE_URL | PostgreSQL接続文字列 |
| GEMINI_API_KEY | Gemini API キー（AI整理機能用） |
| MANUS_KEY_ENCRYPTION_SECRET | ManusAPIキー暗号化用シークレット |
| NEXT_PUBLIC_MATERIAL_CREATOR_URL | 資料生成アプリURL |
| NEXT_PUBLIC_JOB_ANALYZER_URL | 求人出力アプリURL |
| NEXT_PUBLIC_CANDIDATE_INTAKE_URL | 面談登録アプリURL |
| ALLOWED_ORIGINS | 追加CORSオリジン（カンマ区切り） |

---

## 3. API

### /api 配下のルート一覧

#### 認証系 API

| エンドポイント | メソッド | 認証要否 | 説明 |
|---------------|---------|---------|------|
| /api/auth/login | POST | 不要 | ログイン |
| /api/auth/logout | POST | 要 | ログアウト |
| /api/auth/me | GET | 要（Bearer） | ユーザー情報取得（外部アプリ用） |
| /api/auth/consume-invite | POST | 不要 | 招待トークン消費 |
| /api/auth/issue-app-token | POST | 要 | 外部アプリ用トークン発行 |
| /api/auth/verify-app-token | POST | 不要 | 外部アプリ用トークン検証 |

#### 管理者用 API（admin ロール必須）

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| /api/admin/users | GET | ユーザー一覧 |
| /api/admin/users/[id]/status | PATCH | ユーザーステータス変更 |
| /api/admin/users/[id]/manus-key | GET/PATCH/DELETE | ManusAPIキー管理 |
| /api/admin/invites | POST | 招待メール送信 |
| /api/admin/systems | GET | システムリンク一覧 |
| /api/admin/systems/create | POST | システムリンク作成 |
| /api/admin/systems/[id]/update | PATCH | システムリンク更新 |
| /api/admin/audit | GET | 監査ログ一覧 |
| /api/admin/announcements | GET | お知らせ一覧（下書き含む） |
| /api/admin/announcements/create | POST | お知らせ作成 |
| /api/admin/announcements/[id]/update | PATCH | お知らせ更新 |
| /api/admin/announcements/[id]/delete | DELETE | お知らせ削除 |
| /api/admin/announcements/ai-format | POST | お知らせAI整理 |

#### 一般 API（認証済みユーザー）

| エンドポイント | メソッド | 説明 |
|---------------|---------|------|
| /api/systems | GET | 有効なシステムリンク一覧 |
| /api/employees | GET | 社員一覧 |
| /api/candidates | GET | 求職者一覧 |
| /api/master/employees | GET/POST/PATCH | 社員マスタCRUD |
| /api/master/candidates | GET/POST/PATCH | 求職者マスタCRUD |
| /api/jobs/export | POST | 求人エクスポート |
| /api/users/me/manus-key | GET | 自分のManusAPIキー取得 |
| /api/announcements | GET | お知らせ一覧（公開済みのみ） |
| /api/announcements/recent | GET | 最新お知らせ |
| /api/announcements/[id] | GET | お知らせ詳細 |

### 外部公開API

以下のAPIはCORS設定により外部アプリからアクセス可能：

| エンドポイント | 許可オリジン |
|---------------|-------------|
| /api/auth/me | tender-reverence, candidate-intake, kyuujin-pdf-tool, ai-resume-generator |
| /api/auth/verify-app-token | 同上 |
| /api/users/me/manus-key | 同上 |

---

## 4. 技術スタック

### フレームワーク
- Next.js 16.1.6（App Router）
- React 19.2.3

### 主要ライブラリ

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| Prisma | 7.3.0 | ORM |
| @prisma/adapter-pg | 7.3.0 | PostgreSQLアダプター |
| bcryptjs | 3.0.3 | パスワードハッシュ |
| react-markdown | 10.1.0 | Markdownレンダリング |
| remark-gfm | 4.0.1 | GFM対応 |
| xlsx | 0.18.5 | Excelファイル処理 |
| csv-parse | 6.1.0 | CSV解析 |
| zod | 4.3.6 | バリデーション |
| TailwindCSS | 4.x | スタイリング |

### Node.js バージョン
明示的な指定なし（.nvmrc / engines未設定）

---

## 5. DB

### prisma/schema.prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

enum UserRole {
  admin
  member
}

enum UserStatus {
  active
  disabled
}

enum SystemStatus {
  active
  disabled
}

enum AuditTargetType {
  AUTH
  USER
  SYSTEM
  EMPLOYEE
  CANDIDATE
  ANNOUNCEMENT
}

enum AnnouncementCategory {
  IMPORTANT
  FEATURE
  FIX
  MAINTENANCE
  RELEASE
}

enum AnnouncementStatus {
  PUBLISHED
  DRAFT
}

enum EmployeeStatus {
  active
  disabled
}

model User {
  id           String     @id @default(cuid())
  name         String
  email        String     @unique
  passwordHash String     @map("password_hash")
  role         UserRole   @default(member)
  status       UserStatus @default(active)

  // ManusAPIキー（AES-256-GCM暗号化済み）
  manusApiKeyEncrypted String?   @map("manus_api_key_encrypted")
  manusApiKeySetAt     DateTime? @map("manus_api_key_set_at")

  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt      @map("updated_at")

  auditLogs     AuditLog[]     @relation("ActorAuditLogs")
  invitesMade   Invite[]       @relation("InvitesMade")
  appTokens     AppToken[]
  appSessions   AppSession[]
  announcements Announcement[]

  @@map("users")
}

model SystemLink {
  id           String       @id @default(cuid())
  name         String
  description  String
  url          String
  status       SystemStatus @default(active)
  sortOrder    Int          @default(0) @map("sort_order")

  // SSO認証連携
  requiresAuth Boolean      @default(false) @map("requires_auth")
  appId        String?      @map("app_id")

  createdAt    DateTime     @default(now()) @map("created_at")
  updatedAt    DateTime     @updatedAt      @map("updated_at")

  @@map("systems")
}

model Invite {
  id              String    @id @default(cuid())
  email           String
  tokenHash       String    @map("token_hash")
  expiresAt       DateTime  @map("expires_at")
  usedAt          DateTime? @map("used_at")

  createdByUserId String    @map("created_by_user_id")
  createdByUser   User      @relation("InvitesMade", fields: [createdByUserId], references: [id])

  createdAt       DateTime  @default(now()) @map("created_at")

  @@index([email])
  @@index([expiresAt])
  @@map("invites")
}

model AuditLog {
  id          String          @id @default(cuid())
  actorUserId String          @map("actor_user_id")
  actorUser   User            @relation("ActorAuditLogs", fields: [actorUserId], references: [id])

  action      String
  targetType  AuditTargetType @map("target_type")
  targetId    String?         @map("target_id")
  metadata    Json?

  createdAt   DateTime        @default(now()) @map("created_at")

  @@index([actorUserId, createdAt])
  @@index([targetType, createdAt])
  @@map("audit_logs")
}

model Employee {
  id             String         @id @default(cuid())
  employeeNumber String         @unique @map("employee_number")
  name           String
  status         EmployeeStatus @default(active)

  // 担当求職者
  candidates     Candidate[]

  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt      @map("updated_at")

  @@map("employees")
}

model Candidate {
  id              String   @id @default(cuid())
  candidateNumber String   @unique @map("candidate_number")
  name            String
  nameKana        String?  @map("name_kana")
  gender          String?  // "male" | "female" | "other"

  // 担当キャリアアドバイザー
  employeeId      String?  @map("employee_id")
  employee        Employee? @relation(fields: [employeeId], references: [id])

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt      @map("updated_at")

  @@map("candidates")
}

// 外部アプリ遷移用ワンタイムトークン
model AppToken {
  id        String    @id @default(cuid())
  userId    String    @map("user_id")
  user      User      @relation(fields: [userId], references: [id])
  tokenHash String    @map("token_hash")
  targetApp String    @map("target_app")
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")

  @@index([tokenHash])
  @@map("app_tokens")
}

// 外部アプリ用セッション
model AppSession {
  id               String   @id @default(cuid())
  userId           String   @map("user_id")
  user             User     @relation(fields: [userId], references: [id])
  sessionTokenHash String   @map("session_token_hash")
  appId            String   @map("app_id")
  expiresAt        DateTime @map("expires_at")
  createdAt        DateTime @default(now()) @map("created_at")

  @@index([sessionTokenHash])
  @@map("app_sessions")
}

// お知らせ
model Announcement {
  id           String               @id @default(cuid())
  title        String
  content      String               @db.Text
  category     AnnouncementCategory
  status       AnnouncementStatus   @default(DRAFT)
  publishedAt  DateTime?            @map("published_at")
  authorUserId String               @map("author_user_id")
  author       User                 @relation(fields: [authorUserId], references: [id])
  createdAt    DateTime             @default(now()) @map("created_at")
  updatedAt    DateTime             @updatedAt @map("updated_at")

  @@map("announcements")
}
```

---

## 6. フロントエンド

### ページ構成（app/ 配下のルーティング一覧）

#### 認証不要

| パス | ファイル | 説明 |
|------|----------|------|
| /login | src/app/login/page.tsx | ログインページ |
| /invite/[token] | src/app/invite/[token]/page.tsx | 招待受諾ページ |

#### 認証必須（(app) レイアウト配下）

| パス | ファイル | 説明 |
|------|----------|------|
| / | src/app/(app)/page.tsx | ダッシュボード |
| /systems | src/app/(app)/systems/page.tsx | システムリンク一覧 |
| /settings | src/app/(app)/settings/page.tsx | ユーザー設定 |
| /announcements | src/app/(app)/announcements/page.tsx | お知らせ一覧 |
| /announcements/[id] | src/app/(app)/announcements/[id]/page.tsx | お知らせ詳細 |
| /jobs | src/app/(app)/jobs/page.tsx | 求人一覧 |
| /jobs/[id] | src/app/(app)/jobs/[id]/page.tsx | 求人詳細 |
| /ai-jobs | src/app/(app)/ai-jobs/page.tsx | AIジョブ一覧 |
| /ai-jobs/[id] | src/app/(app)/ai-jobs/[id]/page.tsx | AIジョブ詳細 |

#### 管理者専用（admin レイアウト配下）

| パス | ファイル | 説明 |
|------|----------|------|
| /admin | src/app/(app)/admin/page.tsx | 管理者ダッシュボード |
| /admin/users | src/app/(app)/admin/users/page.tsx | 社員管理 |
| /admin/systems | src/app/(app)/admin/systems/page.tsx | システム管理 |
| /admin/master | src/app/(app)/admin/master/page.tsx | マスタ管理（社員・求職者） |
| /admin/audit | src/app/(app)/admin/audit/page.tsx | 監査ログ |
| /admin/announcements | src/app/(app)/admin/announcements/page.tsx | お知らせ管理 |

### 求職者関連ページ

| パス | 説明 |
|------|------|
| /admin/master | 求職者マスタ管理（CRUD操作） |

---

*最終更新: 2026-03-01*
