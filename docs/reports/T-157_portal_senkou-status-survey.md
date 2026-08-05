# T-157 portal 調査報告：選考状況のマイページ連動

調査日: 2026-08-05（JST） / 対象: bizstudio-portal（master・worktree portal-1）
本番DB: staging/production 共有 Postgres（`railway ssh --service bizstudio-portal` 経由・**SELECT のみ**）
コード変更・DB書き込み・マイグレーションは一切行っていない。

数値の母集団は各節に明記。断りのない「支援中」は `Candidate.supportStatus = 'ACTIVE'`（実数 100 名）。

---

## 0. 結論サマリ（10行以内）

1. **エントリーとマイページ求人行の紐付けは「条件付きで可能」**。支援中×`archivedAt IS NULL`×求人紹介以外×`entryDate>=2026-01-01` の 457 件で、`JobEntry.externalJobId = CandidateFile.kyuujinJobId` が **91.7%**、会社名正規化キー併用で **97.6%** 一致。不一致は 11 件（8名）。
2. ただし過去分を含めた全期間（支援中・608 件）では併用で 76.2%（求人紹介を除くと 89.2%）。**FileMaker 由来の旧エントリー（`externalJobId=0`）は構造的に紐付け不能**。
3. **「見送り確定」と「本人通知済み」は明確に区別できる**。`personFlag` に `見送り通知未送信` / `見送り通知送信済` という専用の2値が既に存在し、`EntryFlagMaster` にもマスタ登録済み・実データにも両方存在（全期間で未送信 66 件 / 送信済 2,946 件）。**新カラムは不要**。
4. 表示据え置きの対象（支援中・見送り確定だが本人未通知）は **23 件 / 17 名**。うち 15 件は `personFlag='見送り通知未送信'` で明示、8 件は `entryFlag='エントリー' & detail='クローズ'` で `personFlag` が NULL。
5. `isActive` は据え置き判定に**そのまま使える**。支援中では「通知済なのに active」「未通知なのに inactive」がいずれも **0 件**（`resolveEntryIsActive` が全更新経路で効いている）。全期間では後者が 912 件あるが、すべて FileMaker 一括取込の旧データ。
6. **求職者向け表示は既存データだけで作れる**（追加カラム不要）。ただし「どのブックマーク行に出すか」の紐付け精度を上げるため、`JobEntry` に元 `CandidateFile.id` を持つ nullable カラムを新設するのが望ましい（§4-4）。
7. `CandidateFile.responseStatus` の `IN_SELECTION`/`SELECTION_ENDED` は**現在ほぼ死んでいる**（未アーカイブ全体で 5 件 / 17 件、全て 2026-05〜06 の箱B移行データ。現行コードに書き込み経路なし）。選考状況をここに書き戻す設計は**採らない方が安全**（§5-3 の通知発火リスク）。
8. 表示に使う API は **既存 `GET /api/external/candidate-site/favorites` の拡張が最小変更**。選考状況専用APIは存在しない。
9. データ品質リスクは小さい。支援中の有効エントリー 138 件のうち、日程矛盾 1〜3 件、30日以上未更新 3 件のみ。
10. 最大の懸念は「求人紹介段階(`entryFlag='求人紹介'`)は 100% `isActive=false`」という既存仕様（§10-1）。`isActive` を唯一の可視条件にすると求人紹介行が全部消えるため、判定式は `entryFlag` と併用すること。

---

## 1. JobEntry 構造

出所: `prisma/schema.prisma` L1729-1862（`@@map("job_entries")`）。

### 1-1. 全カラム

| カラム | 型 | null | @map | default | 備考 |
|--|--|--|--|--|--|
| id | String | × | - | cuid() | @id |
| candidateId | String | × | candidate_id | - | → Candidate（onDelete: Cascade） |
| externalJobId | Int | × | external_job_id | - | **kyuujinPDF jobs.id**。手動作成/サイト経由は 0 |
| companyName | String | × | company_name | - | |
| jobTitle | String | × | job_title | - | |
| jobDb | String? | ○ | job_db | - | 媒体名（Circus / HITO-Link / マイナビJOB / Bee / agentbank 等） |
| jobType | String? | ○ | job_type | - | |
| jobCategory | String? | ○ | job_category | - | |
| workLocation | String? | ○ | work_location | - | |
| salary | String? | ○ | - | - | |
| overtime | String? | ○ | - | - | |
| areaMatch | String? | ○ | area_match | - | |
| transfer | String? | ○ | - | - | |
| originalUrl | String? | ○ | original_url | - | kyuujin PDF 側 URL |
| entryDate | DateTime | × | entry_date | - | エントリー日 |
| introducedAt | DateTime | × | introduced_at | - | 紹介日時 |
| createdBy | String? | ○ | created_by | - | |
| createdAt | DateTime | × | created_at | now() | |
| updatedAt | DateTime | × | updated_at | @updatedAt | |
| status | String? | ○ | - | "有効" | 実データ: 有効 3,598 / 終了 1,541 / 決定 5（entryDate>=2026-01-01） |
| externalJobNo | String? | ○ | external_job_no | - | 媒体側求人番号（FM由来は `2_268072_34` 形式） |
| prefecture | String? | ○ | - | - | |
| **entryFlag** | String? | ○ | entry_flag | "求人紹介" | 外側の段階（§2-2） |
| **entryFlagDetail** | String? | ○ | entry_flag_detail | "検討中" | 内側の進行ステータス |
| **companyFlag** | String? | ○ | company_flag | - | 企業対応 |
| **personFlag** | String? | ○ | person_flag | - | 本人対応（**通知有無はここ**） |
| externalJobRef | String? | ○ | external_job_ref | - | T-140。job-platform source_job_id（=CandidateFile.externalJobRef を継承）。**route="site-apply" のみ** |
| taskRequestedAt | DateTime? | ○ | task_requested_at | - | T-120 |
| hasJobPosting / hasEntry / hasJoined | Boolean | × | has_* | false | |
| firstMeetingDate | DateTime? | ○ | first_meeting_date | - | |
| jobMeetingDate | DateTime? | ○ | job_meeting_date | - | |
| **jobIntroDate** | DateTime? | ○ | job_intro_date | - | 求人紹介日 |
| **documentSubmitDate** | DateTime? | ○ | document_submit_date | - | 書類提出 |
| **documentPassDate** | DateTime? | ○ | document_pass_date | - | **書類通過** |
| aptitudeTestExists | Boolean | × | aptitude_test_exists | false | |
| aptitudeTestDeadline | DateTime? | ○ | aptitude_test_deadline | - | |
| interviewPrepDate / Time | DateTime? / String? | ○ | interview_prep_* | - | 面接対策 |
| **firstInterviewDate / Time / Tool** | DateTime? / String? / String? | ○ | first_interview_* | - | 一次面接 |
| **secondInterviewDate / Time / Tool** | 〃 | ○ | second_interview_* | - | 二次面接 |
| **finalInterviewDate / Time / Tool** | 〃 | ○ | final_interview_* | - | 最終面接 |
| **offerDate** | DateTime? | ○ | offer_date | - | **内定** |
| offerDeadline | DateTime? | ○ | offer_deadline | - | |
| offerMeetingDate / Time | DateTime? / String? | ○ | offer_meeting_* | - | オファー面談 |
| **acceptanceDate** | DateTime? | ○ | acceptance_date | - | **承諾** |
| **joinDate** | DateTime? | ○ | join_date | - | **入社** |
| memo | String? (Text) | ○ | - | - | |
| jobDbUrl | String? | ○ | job_db_url | - | |
| **isActive** | Boolean | × | is_active | true | §3-2 |
| careerAdvisorId | String? | ○ | career_advisor_id | - | Employee.id |
| **archivedAt** | DateTime? | ○ | archived_at | - | 論理削除 |
| theoreticalIncome / referralFee / revenue / grossProfit / cost / jobDbCost | Int? | ○ | - | - | 財務 |
| feeType | FeeType? | ○ | fee_type | - | T-088 |
| theoreticalAnnualIncome | Int? | ○ | theoretical_annual_income | - | |
| feeRatePercent | Decimal(5,2)? | ○ | fee_rate_percent | - | |
| route | String? | ○ | - | - | 応募経路。`site-apply` / `スカウト` / 媒体名 / null |
| entryRoute | String? | ○ | entry_route | - | エントリー時媒体 |
| entryJobId | String? | ○ | entry_job_id | - | |
| fmEntryNo | String? | ○ | fm_entry_no | - | FileMaker参照 |
| firstInterviewGtaskId ほか Gtask/Gcal 系 10 列 | String? | ○ | *_gtask_id / *_gcal_id | - | T-066 Google 連携 |

インデックス: `candidateId` / `externalJobId` / `entryFlag` / `isActive` / `archivedAt` / `(careerAdvisorId, entryDate)` / `(careerAdvisorId, documentPassDate)` / `(careerAdvisorId, offerDate)` / `(careerAdvisorId, acceptanceDate)`
リレーション: `candidate: Candidate`（唯一）。**CandidateFile への外部キーは存在しない**。

### 1-2. 求人・求職者の識別子（要点）

- 求人側: `externalJobId`(Int, kyuujin jobs.id・0=無し) / `externalJobNo`(媒体番号) / `externalJobRef`(job-platform UUID・site-apply のみ) / `jobDb` / `companyName` / `jobTitle` / `route` / `entryRoute` / `entryJobId`
- **kyuujin 側 job を指す列は `externalJobId`**。`CandidateFile.kyuujinJobId`（Int）と同じ ID 空間（出所: `HistoryTab.tsx:3176` が `externalJobId: j.id`（kyuujin 求人紹介 API の job.id）を送っている。既存の `job-history/route.ts:172` も「`JobEntry.externalJobId(Int) = CandidateFile.kyuujinJobId(Int)`」を突合キーとして本番稼働中）
- 求職者側: `candidateId` のみ（`candidateNumber` は持たない）

---

## 2. フラグ定義と実データ分布

### 2-1. `src/lib/constants/entry-flag-rules.ts` 全文（変更禁止・読み取りのみ）

```ts
export const PERSON_FLAG_RULES: Record<string, string[]> = {
  "求人紹介": ["辞退受付済", "見送り通知済み"],
  "エントリー": ["辞退受付済", "見送り通知済み"],
  "書類選考": ["辞退受付済", "見送り通知未送信", "見送り通知送信済", "選考通過連絡前"],
  "面接": [
    "辞退受付済", "見送り通知未送信", "見送り通知送信済", "選考通過連絡前",
    "受講完了未確認", "受講完了確認済",
    "日程回収中", "日程回収済", "日程通知前", "日程通知済",
    "本人所感回収中", "本人所感回収済",
  ],
  "内定": [
    "辞退受付済", "選考通過連絡前",
    "内定通知前", "内定通知済",
    "入社案内通知前", "入社案内通知済", "入社済",
  ],
};

export const COMPANY_FLAG_RULES: Record<string, string[]> = {
  "求人紹介": [],
  "エントリー": [],
  "書類選考": ["辞退報告前", "辞退報告済"],
  "面接": [
    "受講完了報告前", "受講完了報告済",
    "希望日提出前", "希望日提出済",
    "日程確定未返信", "日程確定返信済",
    "所感報告前", "所感報告済",
    "辞退報告前", "辞退報告済",
  ],
  "内定": [
    "希望日提出前", "希望日提出済",
    "日程確定未返信", "日程確定返信済",
    "承諾返答前", "承諾返答済",
    "入社報告済",
    "辞退報告前", "辞退報告済",
  ],
};

export const HIDDEN_ENTRY_DETAILS = [
  "本人所感回収中", "所感回収済(提出)", "選考中(所感提出)",
];

export const SELECTION_ENDED_DETAILS = [
  "選考落ち", "本人辞退", "本人辞退_他社決", "本人辞退_自社他", "クローズ", "求人クローズ",
];

export const INACTIVE_TRIGGERS = {
  // 「入社済」は業務上の成功終着点で、専用タブがある。以前は自動無効化していたが、
  // 「無効も表示」ONにしないと入社済タブに現れない不具合の原因になっていたため、対象から除外した。
  personFlags: ["見送り通知送信済", "見送り通知済み"],
  companyFlags: ["辞退報告済"],
  entryFlagDetails: [] as string[], // 本人辞退は企業対応「辞退報告済」で無効化（companyFlags で判定）。entryFlagDetail だけでは無効化しない。
};

export function applyEntryFlagAutoTransitions<T extends {...}>(data: T): T {
  const result = { ...data };
  if (result.personFlag === "入社済") {
    result.entryFlag = "入社済";
    result.entryFlagDetail = null;
  }
  if (
    (result.personFlag && INACTIVE_TRIGGERS.personFlags.includes(result.personFlag)) ||
    (result.companyFlag && INACTIVE_TRIGGERS.companyFlags.includes(result.companyFlag)) ||
    (result.entryFlagDetail && INACTIVE_TRIGGERS.entryFlagDetails.includes(result.entryFlagDetail))
  ) {
    result.isActive = false;
  }
  return result;
}
```

### 2-2. `EntryFlagMaster`（テーブル `entry_flag_masters`）全レコード

モデル: `id / flagType / parentFlag / value / sortOrder / isActive`。全 76 行・全て `isActive=true`。
`person` / `company` は `parentFlag` を持たず**グローバルな一覧**（段階別の絞り込みは `entry-flag-rules.ts` が担う）。

**flagType = entry（外側の段階）**

| sortOrder | value |
|--|--|
| 1 | 求人紹介 |
| 2 | 応募 |
| 3 | エントリー |
| 4 | 書類選考 |
| 5 | 面接 |
| 6 | 内定 |
| 7 | 入社済 |

**flagType = entry_detail（parentFlag ごと）**

| parentFlag | sortOrder → value |
|--|--|
| 求人紹介 | 1 検討中 / 2 本人辞退 / 3 未応募 |
| 応募 | 1 書類確認中 / 2 選考落ち |
| エントリー | 1 本人辞退 / 2 追加情報取得中 / 3 BS作成中 / 4 作成完了送付前 / 5 送付済本人確認 / 6 本人確認済提出 / 7 追加情報依頼前 / 8 写真取得中 / 9 クローズ |
| 書類選考 | 1 選考中 / 2 本人辞退 / 3 選考落ち |
| 面接 | 1 一次日程調整中 / 2 一次面接実施前 / 3 一次面接選考中 / 4 二次日程調整中 / 5 二次面接実施前 / 6 二次面接選考中 / 7 最終日程調整中 / 8 最終面接実施前 / 9 最終面接選考中 / 10 本人辞退 / 11 選考落ち / 12 適性検査受講中 / 13 適性検査受講済 / 14 本人所感回収中 / 15 所感回収済(提出) / 16 選考中(所感提出) |
| 内定 | 1 検討中 / 2 承諾 / 3 本人辞退_他社決 / 4 本人辞退_自社他 / 5 オファー面談日 |
| 入社済 | （マスタ登録なし。実データも `entryFlagDetail=null`） |

**flagType = person（本人対応）**

| sortOrder | value |
|--|--|
| 1 | 辞退受付済 |
| 2 | 受講完了未確認 |
| 3 | 受講完了確認済 |
| **4** | **見送り通知未送信** |
| **5** | **見送り通知送信済** |
| 6 | 選考通過連絡前 |
| 7 | 日程回収中 |
| 8 | 日程回収済 |
| 9 | 日程通知前 |
| 10 | 日程通知済 |
| 11 | 内定通知前 |
| 12 | 内定通知済 |
| 13 | 入社案内通知前 |
| 14 | 入社案内通知済 |
| 15 | 入社済 |
| 15 | 本人所感回収中 |
| 16 | 本人所感回収済 |

※ `見送り通知済み`（`PERSON_FLAG_RULES` の求人紹介/エントリー段階の値）は**マスタに存在しない**が実データには 28 件ある（§3-1）。

**flagType = company（企業対応）**

| sortOrder | value |
|--|--|
| 1 | 受講完了報告前 |
| 2 | 受講完了報告済 |
| 3 | 希望日提出前 |
| 4 | 希望日提出済 |
| 5 | 日程確定未返信 |
| 6 | 日程確定返信済 |
| 7 | 承諾返答前 |
| 7 | 所感報告前 |
| 8 | 所感報告済 |
| 8 | 承諾返答済 |
| 9 | 入社報告済 |
| 10 | 辞退報告前 |
| 11 | 辞退報告済 |

### 2-3. 本番の実データ分布

母集団: `archivedAt IS NULL` かつ `entryDate >= '2026-01-01'`。

| 母集団 | 件数 | isActive=true | isActive=false | 求職者数 |
|--|--|--|--|--|
| 全体 | 5,144 | 155 | 4,989 | 316 |
| 支援中（supportStatus=ACTIVE）のみ | 509 | 136 | 373 | 49 |

参考: `supportStatus` 分布 = BEFORE 3,884 / ENDED 260 / ACTIVE 100 / WAITING 18 / ARCHIVED 1。

#### (a) `entryFlag` × `entryFlagDetail` クロス（全体）

| entryFlag | entryFlagDetail | 計 | active | inactive |
|--|--|--|--|--|
| 求人紹介 | 本人辞退 | 3,337 | 0 | 3,337 |
| 求人紹介 | 未応募 | 242 | 0 | 242 |
| 求人紹介 | 書類見送り※ | 4 | 0 | 4 |
| 求人紹介 | (null) | 1 | 0 | 1 |
| エントリー | 本人辞退 | 114 | 0 | 114 |
| エントリー | クローズ | 76 | 8 | 68 |
| エントリー | 検討中 | 19 | 19 | 0 |
| エントリー | 送付済本人確認 | 2 | 2 | 0 |
| エントリー | 書類見送り※ | 2 | 0 | 2 |
| エントリー | (空文字)※ | 1 | 1 | 0 |
| 書類選考 | 選考落ち | 827 | 12 | 815 |
| 書類選考 | 選考中 | 118 | 43 | 75 |
| 書類選考 | 本人辞退 | 53 | 0 | 53 |
| 書類選考 | 書類見送り※ | 3 | 0 | 3 |
| 面接 | 選考落ち | 157 | 4 | 153 |
| 面接 | 本人辞退 | 95 | 1 | 94 |
| 面接 | 一次日程調整中 | 19 | 19 | 0 |
| 面接 | 一次面接実施前 | 11 | 10 | 1 |
| 面接 | 最終面接実施前 | 4 | 4 | 0 |
| 面接 | 適性検査受講中 | 3 | 2 | 1 |
| 面接 | 一次面接選考中 | 3 | 2 | 1 |
| 面接 | 二次面接実施前 | 2 | 2 | 0 |
| 面接 | 最終面接選考中 | 2 | 2 | 0 |
| 面接 | (null) | 1 | 1 | 0 |
| 内定 | 本人辞退_自社他 | 20 | 1 | 19 |
| 内定 | 承諾 | 9 | 9 | 0 |
| 内定 | 本人辞退_他社決 | 4 | 0 | 4 |
| 内定 | 検討中 | 2 | 0 | 2 |
| 内定 | オファー面談日 | 1 | 1 | 0 |
| 入社済 | (null) | 12 | 12 | 0 |

※ **`書類見送り`（9 件・全期間）と空文字は `EntryFlagMaster` に存在しない値**。旧 FileMaker 取り込み由来と推定（未確認）。判定式のホワイトリストから漏れると分類不能になるので注意。

#### (d) 支援中に限定した同クロス

| entryFlag | entryFlagDetail | 計 | active | inactive |
|--|--|--|--|--|
| 書類選考 | 選考落ち | 177 | 11 | 166 |
| 書類選考 | 選考中 | 72 | 42 | 30 |
| 書類選考 | 本人辞退 | 8 | 0 | 8 |
| 書類選考 | 書類見送り | 1 | 0 | 1 |
| 面接 | 選考落ち | 38 | 4 | 34 |
| 面接 | 一次日程調整中 | 18 | 18 | 0 |
| 面接 | 本人辞退 | 14 | 0 | 14 |
| 面接 | 一次面接実施前 | 10 | 10 | 0 |
| 面接 | 最終面接実施前 | 4 | 4 | 0 |
| 面接 | 適性検査受講中 | 3 | 2 | 1 |
| 面接 | 最終面接選考中 | 2 | 2 | 0 |
| 面接 | 一次面接選考中 | 2 | 2 | 0 |
| 面接 | 二次面接実施前 | 2 | 2 | 0 |
| 面接 | (null) | 1 | 1 | 0 |
| エントリー | 本人辞退 | 37 | 0 | 37 |
| エントリー | クローズ | 32 | 8 | 24 |
| エントリー | 検討中 | 19 | 19 | 0 |
| エントリー | 送付済本人確認 | 2 | 2 | 0 |
| エントリー | (空文字) | 1 | 1 | 0 |
| 求人紹介 | 本人辞退 | 35 | 0 | 35 |
| 求人紹介 | 未応募 | 17 | 0 | 17 |
| 内定 | 承諾 | 7 | 7 | 0 |
| 内定 | 本人辞退_自社他 | 6 | 0 | 6 |
| 内定 | オファー面談日 | 1 | 1 | 0 |

#### (b) `personFlag` 値別（支援中・entryDate>=2026-01-01）

| personFlag | 計 | active |
|--|--|--|
| 見送り通知送信済 | 237 | 0 |
| 辞退受付済 | 99 | 0 |
| (null) | 90 | 73 |
| 見送り通知済み | 18 | 0 |
| 日程通知済 | 16 | 16 |
| **見送り通知未送信** | **15** | **15** |
| 日程回収中 | 8 | 8 |
| 日程回収済 | 8 | 8 |
| 内定通知済 | 5 | 3 |
| 入社案内通知済 | 3 | 3 |
| 本人所感回収済 | 3 | 3 |
| 日程通知前 | 2 | 2 |
| 入社案内通知前 / 受講完了確認済 / 受講完了未確認 / 選考通過連絡前 / 内定通知前 | 各 1 | 各 1 |

#### (c) `companyFlag` 値別（支援中・entryDate>=2026-01-01）

| companyFlag | 計 | active |
|--|--|--|
| (null) | 387 | 88 |
| 辞退報告前 | 44 | 0 |
| 辞退報告済 | 30 | 0 |
| 日程確定返信済 | 16 | 16 |
| 希望日提出前 | 10 | 10 |
| 希望日提出済 | 8 | 8 |
| 承諾返答済 | 7 | 7 |
| 所感報告済 | 3 | 3 |
| 受講完了報告前 | 2 | 2 |
| 日程確定未返信 / 承諾返答前 | 各 1 | 各 1 |

---

## 3. 見送り・本人通知の判定（判定式と実数）

### 3-1. 「見送り／通知／辞退／クローズ／落ち」を含む値の全列挙（実データ・`archivedAt IS NULL` 全期間）

| フィールド | 値 | 件数 |
|--|--|--|
| entryFlagDetail | 本人辞退 | 23,993 |
| entryFlagDetail | 選考落ち | 3,624 |
| entryFlagDetail | クローズ | 155 |
| entryFlagDetail | 本人辞退_自社他 | 93 |
| entryFlagDetail | 本人辞退_他社決 | 48 |
| entryFlagDetail | 書類見送り（マスタ外） | 9 |
| personFlag | 辞退受付済 | 3,342 |
| personFlag | **見送り通知送信済** | 2,946 |
| personFlag | 日程通知済 | 99 |
| personFlag | **見送り通知未送信** | 66 |
| personFlag | **見送り通知済み**（マスタ外） | 28 |
| personFlag | 内定通知済 | 24 |
| personFlag | 入社案内通知済 | 5 |
| personFlag | 日程通知前 / 入社案内通知前 | 2 / 2 |
| personFlag | 内定通知前 | 1 |
| companyFlag | 辞退報告前 | 2,843 |
| companyFlag | 辞退報告済 | 1,633 |

※ `求人クローズ`（`SELECTION_ENDED_DETAILS` に定義あり）は**実データに 0 件**。

### 3-2. 「見送り確定」と「本人通知済み」の区別 → **区別できる**

| 意味 | 判定式 |
|--|--|
| 見送り／終了が確定した（結果） | `entryFlagDetail ∈ SELECTION_ENDED_DETAILS`（`選考落ち / 本人辞退 / 本人辞退_他社決 / 本人辞退_自社他 / クローズ / 求人クローズ`）＋実データ限定値 `書類見送り` |
| **本人へ見送りを通知済み** | `personFlag ∈ ('見送り通知送信済', '見送り通知済み')` |
| **本人へ見送り確定だが未通知** | 上記の見送り確定条件を満たし、かつ `personFlag` が上記2値のいずれでもない（`見送り通知未送信` または NULL） |
| 本人辞退（本人は当然知っている） | `entryFlagDetail LIKE '本人辞退%'` または `personFlag='辞退受付済'` |
| 企業へ辞退報告済み | `companyFlag='辞退報告済'` |

**新カラムは不要**。`personFlag` の `見送り通知未送信` / `見送り通知送信済` が既に「未通知 / 通知済み」を明示的に分けている（`PERSON_FLAG_RULES` の書類選考・面接段階に定義、`EntryFlagMaster` に sortOrder 4/5 で登録、実データ 66 件 / 2,946 件）。

**推奨する据え置き判定式（実装案）**

```
isNoticeSentToCandidate(e) :=
  e.personFlag ∈ ('見送り通知送信済','見送り通知済み','辞退受付済')
  OR e.companyFlag = '辞退報告済'
  OR e.entryFlagDetail LIKE '本人辞退%'

shouldHoldPreviousStage(e) :=
  e.entryFlagDetail ∈ ('選考落ち','書類見送り','クローズ','求人クローズ')
  AND NOT isNoticeSentToCandidate(e)
```

これは `resolveEntryIsActive`（`src/lib/entries/resolveEntryIsActive.ts`）と同じ思想（「結果」では終了にせず「連絡完了」で終了にする）で、既存の運用ルールを一切変えない。

### 3-3. 支援中で「見送り確定だが本人通知が未完了」= **23 件 / 17 名**（全て `isActive=true`）

母集団: 支援中 × `archivedAt IS NULL`（期間制限なし）。

| entryFlag | entryFlagDetail | personFlag | 件数 | active |
|--|--|--|--|--|
| 書類選考 | 選考落ち | 見送り通知未送信 | 11 | 11 |
| エントリー | クローズ | (null) | 8 | 8 |
| 面接 | 選考落ち | 見送り通知未送信 | 4 | 4 |

`personFlag='見送り通知未送信'` の全 15 件（支援中）:

| 求職者番号 | 氏名 | 会社名 | entryFlag | detail | isActive | エントリー日 | 最終更新 |
|--|--|--|--|--|--|--|--|
| 5003186 | 渡邉 勇介 | 東海物産株式会社 | 書類選考 | 選考落ち | true | 2026-07-31 | 2026-08-05 |
| 5008186 | 森田 倫名 | 青山特殊鋼株式会社 | 書類選考 | 選考落ち | true | 2026-08-04 | 2026-08-05 |
| 5008289 | 松澤 旺広 | 日ポリ化工株式会社 | 書類選考 | 選考落ち | true | 2026-07-31 | 2026-08-05 |
| 5008090 | 橋本 遥奈 | 王子ネピア株式会社 | 書類選考 | 選考落ち | true | 2026-07-27 | 2026-08-05 |
| 5008194 | 水野 莉緒 | 株式会社BREXA Communication | 書類選考 | 選考落ち | true | 2026-08-04 | 2026-08-04 |
| 5004138 | 吉武 広太 | 株式会社ナック | 面接 | 選考落ち | true | 2026-07-22 | 2026-08-04 |
| 5008194 | 水野 莉緒 | 吉田建材株式会社 | 書類選考 | 選考落ち | true | 2026-07-29 | 2026-08-04 |
| 5008232 | 辻 一成 | 株式会社LITALICO | 書類選考 | 選考落ち | true | 2026-07-24 | 2026-08-04 |
| 5008159 | 寺澤 薫 | パーソルエクセルHRパートナーズ株式会社 | 書類選考 | 選考落ち | true | 2026-07-30 | 2026-08-03 |
| 5008137 | 中村 初美 | 株式会社 セルム | 書類選考 | 選考落ち | true | 2026-07-14 | 2026-08-03 |
| 5007956 | 鍋田 英佑 | 株式会社シェーンベルグ丸十 | 面接 | 選考落ち | true | 2026-06-22 | 2026-08-03 |
| 5007966 | 半坂 優衣 | 株式会社コスモスイニシア | 面接 | 選考落ち | true | 2026-07-02 | 2026-08-03 |
| 5008188 | 渡辺 来夏 | 株式会社FREEDiVE | 書類選考 | 選考落ち | true | 2026-07-30 | 2026-08-02 |
| 5008213 | 竹森 麻奈香 | パーソルテンプスタッフ株式会社 | 面接 | 選考落ち | true | 2026-07-17 | 2026-07-31 |
| 5004138 | 吉武 広太 | 多摩運送株式会社 | 書類選考 | 選考落ち | true | 2026-07-22 | 2026-07-24 |

残り 8 件は `entryFlag='エントリー' / detail='クローズ' / personFlag=NULL`。**「クローズ」に本人通知フラグが立たない**（`エントリー` 段階の `PERSON_FLAG_RULES` は `辞退受付済 / 見送り通知済み` の2値のみで、`クローズ` に対応する通知フラグの運用が無い）。この 8 件は「見送り確定だが未通知」として据え置くか、そもそもマイページに出さないかの**運用判断が必要**（§7-2）。

### 3-4. `isActive` との整合（逆方向確認）

| 母集団 | 通知済（personFlag ∈ 見送り2値）なのに `isActive=true` | 未通知の見送り確定なのに `isActive=false` |
|--|--|--|
| 支援中 × `archivedAt IS NULL`（608 件） | **0 件** | **0 件** |
| 全期間 × `archivedAt IS NULL`（28,513 件） | **0 件** | 912 件 |

- 「通知済なのに active」は全期間でも 0 件。`resolveEntryIsActive` が全更新経路で機能している。
- 「未通知なのに inactive」の 912 件は全期間のみ。`companyFlag='辞退報告済'` による無効化（支援終了済み求職者の過去分）と、FileMaker 一括取込（`bulk-import/route.ts` は `isActive = status !== "終了" && !SELECTION_ENDED_DETAILS.includes(detail)` という**別ルール**で `isActive` を決めており、`resolveEntryIsActive` を通していない）が原因。
- **結論**: 支援中の求職者に限れば、表示据え置きロジックは `isActive` に依存して**問題ない**。ただし §10-1 の「求人紹介段階は全件 isActive=false」に注意。

---

## 4. JobEntry ↔ CandidateFile 突合率（キー別・実測）

### 4-1. 対応付けに使える候補キー

| キー | JobEntry 側 | CandidateFile 側 | 備考 |
|--|--|--|--|
| kyuujin job id | `externalJobId`(Int) | `kyuujinJobId`(Int) | **主キー候補**。CandidateFile 側に `@@unique([candidateId, kyuujinJobId])` あり＝候補者内で一意。JobEntry 側は 0 が「無し」 |
| job-platform ID | `externalJobRef`(String) | `externalJobRef`(String) | JobEntry 側は route="site-apply" のみ書き込まれる |
| 会社名正規化キー | `companyName` → `normalizeCompanyKey()` | `fileName` → `parseCompanyFromBookmarkFileName()` → `normalizeCompanyKey()` | 既存関数（`src/lib/company-name-key.ts`）。job-history API が本番採用済み |
| 媒体求人番号 | `externalJobNo` | （対応列なし） | 突合不可 |
| CandidateFile.id | **なし** | `id` | §4-4 で新設提案 |

### 4-2. 突合成功率（実測）

正規化は既存関数のみ使用（`normalizeCompanyKey` / `parseCompanyFromBookmarkFileName`）。新しい規則は作っていない。
CandidateFile 側の母集団: 支援中 × `category='BOOKMARK'` × `archivedAt IS NULL` = **2,799 行**。

**(A) 支援中 × `archivedAt IS NULL` × 求人紹介以外 × `entryDate >= 2026-01-01`（= 457 件・実装が実際に扱う範囲）**

| キー | 一致 | 率 |
|--|--|--|
| (a) `externalJobRef` 完全一致 | 18 | 3.9% |
| (b) kyuujin job id 一致 | **419** | **91.7%** |
| (c) 会社名正規化キー一致 | 434 | 95.0% |
| **いずれか一致** | **446** | **97.6%** |
| どれでも不一致 | 11 | 2.4% |

**(B) 支援中 × `archivedAt IS NULL` × 求人紹介以外（全期間・500 件）**

| キー | 一致 | 率 |
|--|--|--|
| (a) externalJobRef | 18 | 3.6% |
| (b) kyuujin job id | 419 | 83.8% |
| (c) 会社名キー | 434 | 86.8% |
| いずれか | 446 | 89.2% |
| 不一致 | 54 | 10.8% |

**(C) 支援中 × `archivedAt IS NULL` 全段階（求人紹介含む・608 件）**

| キー | 一致 | 率 |
|--|--|--|
| (a) externalJobRef | 18 | 3.0% |
| (b) kyuujin job id | 419 | 68.9% |
| (c) 会社名キー | 451 | 74.2% |
| いずれか | 463 | 76.2% |
| (c) だけで拾えた行 | 26 | - |
| 不一致 | 145 | 23.8% |

参考: JobEntry 側の識別子保有率（608 件中）= `externalJobId != 0` 431 件 / `externalJobRef` 非null 18 件 / `externalJobNo` 非null 606 件。
CandidateFile 側（未アーカイブ BOOKMARK 全体 6,526 行）= `kyuujinJobId` 非null 4,926 / `externalJobRef` 非null 6,089。

#### (d) どの方法でも不一致（範囲Aの全 11 件・8 名）

| 求職者番号 | 氏名 | 会社名（JobEntry） | entryFlag/detail | externalJobId | externalJobNo | jobDb | エントリー日 | 正規化キー |
|--|--|--|--|--|--|--|--|--|
| 5008005 | 木暮 衿賀 | 株式会社メイクスデベロップメント_No402772_【不動産事務】東京本社で…宅建資格を活かせる | 書類選考/選考中 | 9226 | 0 | Circus | 2026-08-03 | `メイクスデベロップメントno402772不動産事務…` |
| 5004179 | 井筒 錬 | 株式会社コンピュータシステム研究所 | 書類選考/本人辞退 | 0 | 2_130999_34 | Circus | 2026-03-19 | コンピュータシステム研究所 |
| 5004138 | 吉武 広太 | 株式会社ベジテック | 書類選考/選考落ち | 0 | 7_236551_20 | HITO-Link | 2026-04-07 | ベジテック |
| 5004179 | 井筒 錬 | 川本サービス株式会社 | 書類選考/選考中 | 0 | 2_314563_34 | Circus | 2026-03-19 | 川本サービス |
| 5004179 | 井筒 錬 | 大宝製袋株式会社 | 書類選考/選考落ち | 0 | 2_374120_34 | Circus | 2026-03-19 | 大宝製袋 |
| 5004402 | 大木 涼太 | 株式会社ハウスメイトパートナーズ_No350362 | 面接/選考落ち | 5097 | 1 | マイナビJOB | 2026-05-20 | `ハウスメイトパートナーズno350362` |
| 5003186 | 渡邉 勇介 | ファインフーズ株式会社 | 書類選考/選考落ち | 5785 | 296791 | HITO-Link | 2026-06-10 | ファインフーズ |
| 5004595 | 東 幸汰 | 株式会社日本トリム_No342055 | 書類選考/選考落ち | 4489 | 1 | マイナビJOB | 2026-05-22 | `日本トリムno342055` |
| 5004041 | 桑原 泉希 | 株式会社平田タイル | 書類選考/選考落ち | 1626 | 216716 | HITO-Link | 2026-06-18 | 平田タイル |
| 5004089 | 石川 心詩 | 株式会社マイナビワークス_No134545 | エントリー/クローズ | 7567 | 1 | マイナビJOB | 2026-06-24 | `マイナビワークスno134545` |
| 5004595 | 東 幸汰 | タツミ産業株式会社 | 面接/選考落ち | 5009 | 188194 | Circus | 2026-06-26 | タツミ産業 |

不一致の原因は3系統:
1. **`JobEntry.companyName` にファイル名の残骸が入っている**（`_No402772_…` / `_No350362`）: 4 件。kyuujin 側の `company_name` がそのままファイル名だったケース。`stripFileMetadata()`（`src/lib/normalize-filename.ts`）を通せば救えるが、**現状の会社名キー計算は生の `companyName` を使うため落ちる**。
2. **`externalJobId=0` の手入力／FileMaker由来**（Circus・HITO-Link）: 4 件。元ブックマークが存在しない＝構造的に紐付け不能。
3. **`externalJobId` はあるが対応する未アーカイブブックマークが無い**（ファインフーズ・平田タイル・タツミ産業）: 3 件。

### 4-3. 一意に定まらないケース

- 会社名キーが**複数の CandidateFile に当たる** JobEntry: 範囲Aで **66 件**（全 457 件の 14.4%）。範囲Cでは 70 件。
- ブックマーク側で同一会社名キーが重複する（候補者×会社）の組: **174 組 / 対象 384 行**（支援中・未アーカイブ）。

→ **会社名キー単独では「どのカードに出すか」を決められない**。kyuujin job id を第一キー、会社名キーはフォールバック（複数ヒット時は表示しないか、全ヒット行に同じ状態を出すかを要判断）とすべき。

### 4-4. エントリー作成経路と CandidateFile.id の保持状況

| # | 経路 | ファイル | 起点 | 元 CandidateFile.id を保存? | 保存している求人キー |
|--|--|--|--|--|--|
| 1 | 求人紹介タブ →「エントリーへ登録」 | `src/app/api/candidates/[candidateId]/entries/route.ts:77`（呼出元 `HistoryTab.tsx:3160-3200`） | CA・UI | **× 保存しない** | `externalJobId = kyuujin job.id` / `externalJobNo` / `companyName` |
| 2 | ブックマーク（サイト経由）→「エントリーへ登録」 | `src/app/api/candidates/[candidateId]/bookmarks/to-entry/route.ts:145` | CA・UI | **× 保存しない**（`fileIds` を受け取っているのに捨てている） | `externalJobId=0` / `externalJobRef = CandidateFile.externalJobRef` / `externalJobNo` / `jobDb` / `route="site-apply"` |
| 3 | エントリーボードの手入力追加 | `src/app/api/entries/route.ts:163` | CA・UI | **× 該当なし** | `externalJobId=0` / `companyName` のみ |
| 4 | FileMaker 一括取込 | `src/app/api/internal/entries/bulk-import/route.ts:106` | 内部API（INTERNAL_API_KEY） | **× 該当なし** | `externalJobId=0` / `fmEntryNo` / `externalJobNo` |

**#2 が最も惜しい**: `to-entry` は入力として `fileIds: string[]` を受け取り、その CandidateFile を `findMany` で引いているのに、JobEntry には id を残していない（`externalJobRef` のみ）。

#### 最小の変更案

```prisma
model JobEntry {
  // T-157: このエントリーの元になったブックマーク行（CandidateFile.id）。
  // マイページの求人カードへ選考状況を出す際の一意な紐付けキー。
  // 手入力・FileMaker取込など元行が無い経路は null（既存行は全て null＝挙動不変）。
  sourceCandidateFileId String?        @map("source_candidate_file_id")
  sourceCandidateFile   CandidateFile? @relation(fields: [sourceCandidateFileId], references: [id], onDelete: SetNull)
  @@index([sourceCandidateFileId])
}
```

- 経路 #2 は `f.id` をそのまま入れるだけ（1行追加）。
- 経路 #1 は現在 kyuujin の job 情報しか持たないため、`HistoryTab` 側で `findBookmarkSource()`（既に会社名照合で元ブックマークを引いている・`HistoryTab.tsx:3050` 付近）が返す行の id を payload に足せば入る。
- 既存行 1,700 件超のバックフィルは `externalJobId = kyuujinJobId` で 91.7%（直近分）埋まる。**新規行だけ確実にすれば、時間の経過とともに 100% に収束する**。
- nullable 追加のみ・既存挙動不変なので `07-deploy-rules.md` の「master 直 push 可」に該当。

---

## 5. responseStatus の現状と書き込み経路・副作用

### 5-1. 取りうる値と実件数

正準値（`src/lib/constants/response-status.ts`）: `UNANSWERED / INTERESTED / APPLY / PENDING / EXCLUDED / IN_SELECTION / SELECTION_ENDED`（String 運用・DB enum ではない）。

**未アーカイブ BOOKMARK 全体**

| responseStatus | 件数 | updatedAt あり | submittedAt あり |
|--|--|--|--|
| (null) | 4,135 | 0 | 0 |
| UNANSWERED | 1,091 | 54 | 17 |
| INTERESTED | 451 | 451 | 219 |
| APPLY | 430 | 430 | 257 |
| PENDING | 269 | 269 | 185 |
| EXCLUDED | 128 | 128 | 26 |
| **SELECTION_ENDED** | **17** | 17 | 17 |
| **IN_SELECTION** | **5** | 5 | 5 |

アーカイブ含む全 BOOKMARK: (null) 5,377 / UNANSWERED 1,103 / INTERESTED 470 / APPLY 433 / PENDING 275 / EXCLUDED 129 / SELECTION_ENDED 17 / IN_SELECTION 5。

**支援中に限定（未アーカイブ・2,799 行）**: (null) 1,335 / UNANSWERED 581 / INTERESTED 317 / APPLY 279 / PENDING 220 / EXCLUDED 66 / **IN_SELECTION 1** / **SELECTION_ENDED 0**。

**`IN_SELECTION` / `SELECTION_ENDED` は誰が書いたか**: 全 22 行は 4 名（5007934・5008008・5004338・5004292）に集中し、`responseStatusUpdatedAt` は 2026-05-28 / 06-11 / 06-17 / 06-26 に固まっている。うち 21 行は `supportStatus=ENDED` の求職者。**現行コードにこの2値を書き込む経路は存在しない**（`response-status` API は `actor` が `user` でも `ca` でも `USER_SETTABLE_STATUSES` に含まれない値を…と思いきや `actor=ca` なら通る仕様だが、CA画面 UI にこの操作は無い＝`HistoryTab.tsx` は `responseStatus` を**表示のみ**）。実態は T-133 の箱B（kyuujinPDF `feedback_status`）移行スクリプト `scripts/t133-migrate-box-b.ts` が持ち込んだ**休眠データ**。`job-history/route.ts:75-76` にも「箱B由来の休眠列で、選考の実態は JobEntry が正」と明記されている。

参考: `CandidateResponseSubmission` は 143 件 / 63 名（最新 2026-08-04）。

### 5-2. `responseStatus` を書き込むコード経路（全列挙）

| # | 経路 | 誰の操作 | 書き込む値 | 備考 |
|--|--|--|--|--|
| 1 | `PATCH /api/external/candidate-site/response-status` | mypage BFF 経由の**求職者本人**（actor="user"）または **CA**（actor="ca"） | 7値のいずれか（user は `UNANSWERED/INTERESTED/APPLY/PENDING` のみ・`EXCLUDED` と選考2値は CA のみ） | `responseStatusUpdatedAt=now`、EXCLUDED 時は `excludedBy/excludedAt` セット、他値へは無条件クリア。同値変更は no-op |
| 2 | `POST /api/external/candidate-site/favorites` | 求職者本人（お気に入り追加） | **書かない**（`responseStatus` は null のまま作成） | - |
| 3 | `POST /api/external/candidate-site/response-submission` | 求職者本人（まとめ送信） | `responseStatus` は**変更しない**。`responseSubmittedAt=now` のみ更新 | - |
| 4 | `ensureBookmarkForMypageResponse()`（`src/lib/mypage-response-sync.ts:457`） | 旧マイページ webhook（kyuujin candidate-response）受信時 | `APPLY`（WANT_TO_APPLY）/ `INTERESTED` | 行が無いときのみ create。`responseStatusUpdatedAt = responseSubmittedAt = respondedAt`（送信済み扱い） |
| 5 | `scripts/t133-migrate-box-b.ts` | 手動スクリプト（T-133 箱B移行） | 箱B `feedback_status` をそのまま（`IN_SELECTION`/`SELECTION_ENDED` の出所） | 実行済み |
| 6 | `scripts/backfill-site-response-bookmarks.ts` | 手動スクリプト（サイト応募ブックマーク救済） | `APPLY` / `INTERESTED` | 実行済み |

**CA 管理画面（`HistoryTab.tsx`）は `responseStatus` を読むだけで一切書かない**（表示・ソート用）。

### 5-3. 変更時の副作用（**通知の発火条件**）

`responseStatus` の**変更そのもの**（経路 #1）で起きること:

1. `CandidateFile.responseStatus / responseStatusUpdatedAt`（＋EXCLUDED 時は `excludedBy/excludedAt`）を更新。
2. `PORTAL_INTENT_MAP[status] !== undefined` かつ `row.kyuujinJobId != null` のときのみ `applyJobResponseIntent()` → **`CandidateJobResponse` の upsert または削除**。
   - `INTERESTED → INTERESTED` / `APPLY → WANT_TO_APPLY` / `UNANSWERED・PENDING・EXCLUDED → 削除`
   - **`IN_SELECTION` / `SELECTION_ENDED` は `undefined` = 同期対象外**（CJR に触らない）
3. 上記 2 が走ったときのみ `createOrUpdateResponseTask()` → **CAタスク生成/更新 ＋ LINE WORKS タスクBot通知**。
   - 取り消し方向（intent=null）は `{refreshOnly:true}` で「既存の未着手タスクがある場合のみ本文追従」＝新規タスクは生えない。
   - タスク更新時も LINE 通知を送るが、**直前更新から10分以内は通知のみスキップ**（本文更新は必ず実施）。
   - 求職者単位の `pg_advisory_xact_lock` で直列化。

**まとめ送信（経路 #3）で起きること**:
- `CandidateResponseSubmission` + `Item` を作成 → `responseSubmittedAt` 更新 → `INTERESTED/APPLY` 行の CJR upsert → `createOrUpdateResponseTask()` → **① LINE WORKS マイページBot通知 ② 求職者への Resend 確認メール**。
- 通知①の発火条件: `LINEWORKS_CLIENT_ID` + `LINEWORKS_MYPAGE_BOT_ID` + `LINEWORKS_MYPAGE_CHANNEL_ID` が**全て設定済み**。差分が成立すれば件数0でもヘッダのみ送信。
- 通知②の発火条件: `Candidate.email` が存在し `RESEND_API_KEY` が設定済み。

> **T-157 実装上の最重要結論**: 選考状況を `responseStatus` へ書き戻す設計（`IN_SELECTION` / `SELECTION_ENDED` を CA/バッチで一括投入）は、**`PORTAL_INTENT_MAP` が `undefined` なので CJR 同期・タスク・LINE 通知は発火しない**（設計上は安全）。しかし `INTERESTED/APPLY` から `IN_SELECTION` へ変えると `PORTAL_INTENT_MAP['IN_SELECTION']` が undefined なので **CJR 行が残ったまま**になり、マイページ回答タスクの全量本文に「気になる」として出続ける不整合が起きる。逆に一括で `UNANSWERED/PENDING` へ落とすと `intent=null` で CJR 削除＋タスク本文更新が全求職者分走り、**10分dedup を超えた分だけ LINE WORKS 通知が大量発火する**。**推奨は「responseStatus を触らず、選考状況は JobEntry から都度導出して読み取り専用フィールドとして返す」**（§9）。

### 5-4. 付随カラムの意味

| カラム | 意味 |
|--|--|
| `responseStatusUpdatedAt` | 仕分けを変更した日時。同値変更では進めない（偽の未送信差分を作らないため）。null = 一度も仕分けしていない |
| `responseSubmittedAt` | 現在の仕分けを最後に「まとめ送信」した日時。null = 未送信 |
| 差分送信の判定 | `responseStatus ∈ {INTERESTED, APPLY, PENDING}` かつ（`responseSubmittedAt IS NULL` または `responseStatusUpdatedAt > responseSubmittedAt`）。favorites GET の `hasUnsubmittedChange` と `response-submission` の raw SQL が同一解釈 |
| `introducedAt` | 紹介日時（`createdAt`＝行作成時刻とは別意味）。未アーカイブ BOOKMARK 6,526 行中 1,730 行に値あり |
| `CandidateResponseSubmission` | 1送信＝複数求人のスナップショット。`interestedCount` / `applyCount` / `notifiedAt`。`Item` が `candidateFileId` + 送信時点の `responseStatus` を保持 |

---

## 6. candidate-site API 現状

### 6-1. `/api/external/candidate-site/` 配下の全エンドポイント

認証はすべて `verifyCandidateSiteKey()`（ヘッダ `X-Auth-Key` = `CANDIDATE_SITE_API_KEY`・`timingSafeEqual`・**env 未設定は全 401 の fail-closed**）。対象求職者は `resolveScopedCandidate({candidateId | candidateNumber})` で1名に厳密スコープ。

| パス | メソッド | 主なリクエスト | 主なレスポンス |
|--|--|--|--|
| `activity-log` | POST | candidateId/Number ＋ ログ内容 | ok |
| `applications` | GET | candidateId/Number | 応募済み一覧 |
| `apply` | POST | candidateId/Number, externalJobRef | 応募記録（`CandidateJobApplication`）＋担当CA通知 |
| `display-order` | PATCH | fileId 群と順序 | CA手動並び順（`displayOrder`） |
| `display-overrides` | PATCH | fileId, 13項目の上書き | `displayOverrides` |
| `favorites` | **GET / POST / PATCH / DELETE** | GET: `?candidateNumber=` or `?candidateId=` | 下表 |
| `pickup` | PATCH | fileId, on/off | `pickedUpAt`（上限3件/求職者） |
| `preferences` | GET | candidateId/Number | 志向情報 |
| `questions` | POST | 質問本文 | 質問タスク生成 |
| `questions/summarize` | POST | - | 要約 |
| `response-status` | PATCH | fileId? / kyuujinJobId?, status, actor | 仕分け変更（§5-2 #1） |
| `response-submission` | POST | candidateId/Number | まとめ送信（§5-3） |

**`GET favorites` のレスポンス項目（`FavoriteDTO`・`favorites/route.ts:68-107`）**

`id` / `externalJobRef` / `sourceJobId` / `kyuujinJobId` / `responseStatus` / `caMatchLabel` / `introducedAt` / `responseSubmittedAt` / `hasUnsubmittedChange` / `sourceType` / `origin`（"ca"|"candidate"） / `fileName` / `companyName` / `jobUrl` / `candidateNote` / `caComment` / `displayOverrides` / `displayOrder` / `pickedUpAt` / `aiRecommendation` / `aiMatchRating` / `createdAt` / `applied`

トップレベル: `{ ok, candidateNumber, favorites[], appliedExternalJobRefs[] }`。
取得元: `CandidateFile` の `category='BOOKMARK' AND archivedAt IS NULL`、並びは `displayOrder ASC NULLS LAST, createdAt DESC`。

### 6-2. 選考状況を返す API は**存在しない**

現在 favorites が返す選考関連情報は `responseStatus`（＝求職者本人の意思表示）だけで、`JobEntry` は一切参照していない。

**最小変更の提案**: `GET /api/external/candidate-site/favorites` の `FavoriteDTO` に読み取り専用フィールドを1本足す。

```ts
/** T-157: 選考状況（JobEntry から導出・読み取り専用）。null = 選考に入っていない。 */
selectionStatus: {
  stage: "APPLIED" | "DOC_SCREENING" | "DOC_PASSED" | "SCHEDULING"
       | "INTERVIEW_FIXED" | "INTERVIEW_2ND" | "INTERVIEW_FINAL"
       | "OFFER" | "CLOSED";
  label: string;          // 求職者向け表示文言
  updatedAt: string | null;
} | null;
```

- DB スキーマ変更なし・既存フィールド不変（後方互換）。
- 実装は候補者1名分の `JobEntry` を1クエリ追加で取り、`kyuujinJobId`（＋将来 `sourceCandidateFileId`）で Map 化して各 favorite に載せるだけ。**`job-history/route.ts:161-197` と同一パターンで、N+1 にならない実績がある**。
- 通知・タスク・CJR には一切触れないため §5-3 のリスクを完全に回避できる。

### 6-3. ダッシュボードタブ（選考ファネル）の判定ロジック

`src/app/api/candidates/[candidateId]/dashboard/route.ts`

```ts
const ENTRY_FLAGS      = new Set(["エントリー","書類選考","面接","内定","入社済"]);
const DOC_PLUS_FLAGS   = new Set(["書類選考","面接","内定","入社済"]);
const FIRST_PLUS_FLAGS = new Set(["面接","内定","入社済"]);
const IN_SELECTION_FLAGS = new Set(["書類選考","面接","内定"]);

// 選考ファネル（到達社数・会社単位 distinct）
const funnel = {
  entry:  entryCompanies,
  doc:    distinctCompanies((e) => e.documentSubmitDate != null || DOC_PLUS_FLAGS.has(e.entryFlag ?? "")),
  first:  distinctCompanies((e) => e.firstInterviewDate  != null || FIRST_PLUS_FLAGS.has(e.entryFlag ?? "")),
  second: distinctCompanies((e) => e.secondInterviewDate != null),
  offer:  distinctCompanies((e) => e.entryFlag === "内定" || e.entryFlag === "入社済" || e.finalInterviewDate != null),
};
```

ファイル冒頭の注記（原文）:
> ⚠️ 選考ファネル/通過率は「履歴を持たない近似」: JobEntry は現在ステータス（entryFlag）の単一値しか持たないため、各段階の「到達」は『当該段階の日付フィールド presence』または『現在の entryFlag が当該段階以降』で判定する。過去にその段階を通って今は別ステータス、という履歴は復元できないため、率はあくまで目安。

**求職者向け表示に流用できるか → 部分的に可（そのままは不可）**

| 観点 | 評価 |
|--|--|
| 「段階に到達したか」の判定（日付 presence ∪ entryFlag が当該段階以降） | **流用すべき**。既存運用と同一の解釈でブレない |
| 会社単位 distinct 集計 | 流用不可。求職者向けは**求人カード1件ごと**に状態が要る |
| **見送り/通知の考慮が無い** | **致命的**。ファネルは `isActive` も `personFlag` も見ていないため、そのまま出すと**未通知の不合格が求職者に漏れる**。§3-2 の据え置き判定を必ず前段に噛ませること |
| 単調性（内定なら一次も通過扱い） | 流用可。求職者向けにも同じ扱いが自然 |

既にある `src/app/api/internal/candidates/[candidateNumber]/job-history/route.ts` の `toEntryStage()`（`offerDate → OFFER` / `documentPassDate → DOC_PASS` / `entryFlag ∈ ENTRY_FLAG_POST_APPLICATION → ENTRY`）と、その母集団の柵（`archivedAt=null AND isActive=true AND externalJobId != 0`）が、**T-157 に一番近い既存実装**。この API は「無効エントリー＝選考が終わった行はエントリー系にせず従来判定へフォールバック」しており、思想は T-157 の据え置きと同型。

---

## 7. 表示マッピング案の実データ検証

### 7-1. 暫定マッピングを排他的な判定式にした結果（支援中 × `archivedAt IS NULL` = 608 件）

判定順（上から先に当たったものを採用）:

| # | 表示状態 | 判定式 | 件数 | active | 求職者数 |
|--|--|--|--|--|--|
| 0 | **（非表示）求人紹介止まり** | `entryFlag='求人紹介'` | 108 | 0 | 6 |
| 1 | 選考終了（見送り通知済） | `personFlag ∈ ('見送り通知送信済','見送り通知済み')` | 281 | 0 | 39 |
| 2 | 選考終了（辞退） | `personFlag='辞退受付済' OR companyFlag='辞退報告済'` | 81 | 0 | 26 |
| 3 | 入社 | `entryFlag='入社済'` | 2 | 2 | 2 |
| 4 | 内定 | `entryFlag='内定'` | 8 | 8 | 8 |
| 5 | **据え置き（書類選考中・見送り未通知）** | 見送り確定 ∧ 未通知 ∧ `entryFlag≠'面接'` | **19** | 19 | 14 |
| 6 | **据え置き（面接中・見送り未通知）** | 見送り確定 ∧ 未通知 ∧ `entryFlag='面接'` | **4** | 4 | 4 |
| 7 | 日程調整中 | `entryFlag='面接' ∧ detail LIKE '%日程調整中'` | 18 | 18 | 13 |
| 8 | 面接日程確定 | `entryFlag='面接' ∧ detail LIKE '%面接実施前'` | 16 | 16 | 10 |
| 9 | 面接結果待ち | `entryFlag='面接' ∧ detail LIKE '%面接選考中'` | 4 | 4 | 4 |
| 10 | 適性検査 | `entryFlag='面接' ∧ detail LIKE '適性検査%'` | 2 | 2 | 1 |
| 11 | 面接（その他） | `entryFlag='面接'` の残り | **1** | 1 | 1 |
| 12 | 書類通過 | `documentPassDate IS NOT NULL` | **0** | 0 | 0 |
| 13 | 書類選考中 | `entryFlag='書類選考'` | 42 | 42 | 17 |
| 14 | 応募準備中 | `entryFlag ∈ ('エントリー','応募')` | 22 | 22 | 6 |
| 15 | 未分類 | それ以外 | **0** | 0 | 0 |

参考（非排他の素の分布・同母集団）: `documentPassDate` 非null = 114 件 / 見送り通知済 or 辞退報告済 = 325 件。

### 7-2. 暫定案で表現できない・判断が要る状態

| 問題 | 実数 | 内容と対処案 |
|--|--|--|
| **A. 「書類選考通過／一次面接」が独立した状態にならない** | 該当 0 件 | `documentPassDate` が入る行は必ず `entryFlag='面接'` 以降に進んでいるため、判定順で面接系に吸われる。**「書類通過」は単独の表示状態にせず、面接系の入口（=日程調整中）に畳むべき**。あるいは判定順を「documentPassDate ∧ entryFlag='書類選考'」に限定した独立枠にする（現状 0 件だが将来の取りこぼし防止） |
| **B. 「クローズ」に本人通知フラグが無い** | 8 件 / 8名（`entryFlag='エントリー' ∧ detail='クローズ' ∧ personFlag=NULL`） | エントリー段階の `PERSON_FLAG_RULES` は `辞退受付済 / 見送り通知済み` のみで、求人クローズ（企業都合の募集終了）を本人へ通知するフラグが存在しない。**要運用判断**: ①据え置き（応募準備中のまま）／②「募集終了」という専用表示を新設（本人に不利益な情報ではないので通知前提を外せる）。②を推奨 |
| **C. 面接段階だが detail が NULL** | 1 件（5008213 竹森 麻奈香・マンパワーグループ株式会社・`personFlag`/`companyFlag` とも NULL） | フラグ未入力。**フォールバック文言（「選考中」）を必ず用意する**。未分類のまま落とすと画面が空になる |
| **D. 「二次／最終面接」を独立表示できるが件数が極小** | 二次面接実施前 2 / 最終面接実施前 4 / 最終面接選考中 2 | `entryFlagDetail` の接頭辞（一次/二次/最終）で表現可能。暫定案どおり実装できる |
| **E. 「日程調整中」と「面接日程確定」の境界** | 調整中 18 / 確定 16 | 暫定案は「面接日が入力され確定フラグが立っている」だが、実データでは `entryFlagDetail='○次面接実施前'` が確定を表す。**面接日 presence ではなく detail を正とすべき**（§8 の日程矛盾 1〜3 件は detail が遅れているケース。日付を正にすると未確定を確定と誤表示する） |
| **F. `書類見送り`（マスタ外の値）** | 支援中 1 件 | ホワイトリストに入れ忘れると未分類になる。判定式に必ず含めること |
| **G. 求人紹介段階（108 件・6名）** | 108 件 | `entryFlag='求人紹介'` は 100% `isActive=false`（§10-1）。マイページには「気になる/応募したい」の仕分けのみ出し、選考状況は出さない＝`selectionStatus: null` |

### 7-3. 代替マッピング案（推奨）

| 求職者向け表示 | 判定（上から順に評価） |
|--|--|
| （表示なし） | `entryFlag='求人紹介'` または JobEntry 未紐付け |
| **選考終了** | `personFlag ∈ ('見送り通知送信済','見送り通知済み','辞退受付済')` OR `companyFlag='辞退報告済'` OR `entryFlagDetail LIKE '本人辞退%'` |
| **入社決定** | `entryFlag='入社済'` |
| **内定** | `entryFlag='内定'` OR `offerDate IS NOT NULL` |
| **（据え置き）** | `entryFlagDetail ∈ ('選考落ち','書類見送り','クローズ','求人クローズ')` かつ上の「選考終了」に当たらない → **`entryFlag` だけで下の段階を再判定**（面接→「面接選考中」／書類選考→「書類選考中」／エントリー→「応募準備中」）。※ クローズは §7-2 B の判断次第で「募集終了」へ |
| **最終面接** | `entryFlagDetail LIKE '最終%'` |
| **二次面接** | `entryFlagDetail LIKE '二次%'` |
| **面接日程確定** | `entryFlagDetail LIKE '%面接実施前'` |
| **日程調整中** | `entryFlagDetail LIKE '%日程調整中'` |
| **適性検査** | `entryFlagDetail LIKE '適性検査%'` |
| **面接選考中** | `entryFlag='面接'`（残り。detail NULL のフォールバック含む） |
| **書類選考中** | `entryFlag='書類選考'`（`documentPassDate` があれば「書類選考通過」） |
| **応募準備中** | `entryFlag ∈ ('エントリー','応募')` |

---

## 8. データ品質リスク

母集団: `archivedAt IS NULL` かつ `isActive=true`（＝求職者に見える可能性がある行）。

| 指標 | 全体（294 件） | 支援中（138 件） |
|--|--|--|
| 日程矛盾（厳密版＝`isScheduleStatusMismatch` 同等: `companyFlag='日程確定返信済'` ∧ `personFlag='日程通知済'` ∧ `detail LIKE '%日程調整中'` ∧ 該当段階の面接日あり） | **1** | **1** |
| 日程矛盾（緩い版＝面接日が入っているのに `detail` が日程調整中のまま） | **4** | **3** |
| 書類通過日があるのに `entryFlag` が書類選考以下 | 0 | 0 |
| 内定日があるのに `entryFlag` が内定未満 | 0 | 0 |

`isScheduleStatusMismatch` の原文（`src/components/entries/EntryTable.tsx:180-192`）:

```ts
function isScheduleStatusMismatch(entry: Entry): boolean {
  if (entry.companyFlag !== "日程確定返信済") return false;
  if (entry.personFlag !== "日程通知済") return false;
  const detail = entry.entryFlagDetail || "";
  if (!detail.includes("日程調整中")) return false;
  const stageDate =
    detail === "一次日程調整中" ? entry.firstInterviewDate :
    detail === "二次日程調整中" ? entry.secondInterviewDate :
    detail === "最終日程調整中" ? entry.finalInterviewDate : null;
  return !!stageDate && String(stageDate).trim() !== "";
}
```

**放置（最終更新からの経過）**: 母集団 = `archivedAt IS NULL` ∧ `isActive=true` ∧ `entryFlag≠'求人紹介'`

| | 全体（294 件） | 支援中（138 件） |
|--|--|--|
| 30日以上未更新 | 152（51.7%） | **3（2.2%）** |
| 60日以上未更新 | 135 | 2 |
| 90日以上未更新 | 135 | 2 |

支援中の 30 日以上未更新 3 件（全件）:

| 求職者番号 | 氏名 | 会社名 | entryFlag/detail | 最終更新 |
|--|--|--|--|--|
| 5000074 | 道西 未来 | マンパワーグループ株式会社 | 入社済 / (null) | 2026-04-14 |
| 5000592 | 大塩 未来 | 株式会社bサーチ | 入社済 / (null) | 2026-04-28 |
| 5004254 | 岩谷 美緒 | ソーシャルインクルー株式会社 | 内定 / 承諾 | 2026-07-06 |

いずれも**終着状態（入社済・承諾）**であり、「放置により古い選考中状態が出続ける」実害はゼロ。全体側の 152 件は支援終了済み求職者の残骸で、マイページには出ない。

**結論**: T-157 が扱う支援中の範囲では、データ品質は求職者公開に耐える水準。ただし §7-2 C の「フラグ未入力（detail NULL）」に対するフォールバックだけは必須。

---

## 9. 実装分割案（portal 側）

依存順。各本は独立してデプロイ可能。

| # | 内容 | 規模感 | デプロイ判断 |
|--|--|--|--|
| **P1** | **選考状況の導出ロジックを1ファイルに切り出す**（`src/lib/entries/selection-status.ts` 新設）。§7-3 のマッピング＋§3-2 の据え置き判定を純関数として実装。単体テスト用に入出力のみ。既存コードからは未参照＝挙動不変 | 小（新規1ファイル ~120行） | master 直 push 可（純粋追加） |
| **P2** | **`favorites` GET に `selectionStatus` を追加**（§6-2）。候補者1名の `JobEntry` を1クエリ取得 → `kyuujinJobId` で Map 化 → P1 の関数で各行を判定。母集団の柵は `archivedAt IS NULL`（`isActive` では絞らない＝据え置き対象を落とさないため）。**`responseStatus` は一切書き換えない** | 中（既存1ファイル ~60行追加） | **staging 必須**（既存 API のレスポンス変更・mypage が依存） |
| **P3** | **`JobEntry.sourceCandidateFileId` の追加**（§4-4）。nullable カラム＋index、`to-entry` と `HistoryTab→entries` の2経路で書き込み。P2 の突合を「新カラム優先 → kyuujinJobId → 会社名キー」の3段に強化 | 中（migration + 3ファイル） | migration は master 直 push 可（nullable 追加）／書き込み経路変更は staging 推奨 |
| **P4** | **既存行のバックフィル**（`scripts/t157-backfill-source-file.ts`）。`externalJobId = kyuujinJobId` で埋める dry-run → execute。直近分で 91.7% が埋まる見込み | 小（スクリプト1本） | dry-run 必須・DB書き換えなので staging 検証後 |
| **P5**（任意） | **会社名フォールバックの精度改善**。`JobEntry.companyName` に `_No123456_タイトル` が混入する行（§4-2(d) 系統1・実測 4/457）に `stripFileMetadata()` を通してから `normalizeCompanyKey()` する。既存 T-146 の知見と同型 | 小 | master 直 push 可 |
| **P6**（任意） | **CA向けアラート**: 「見送り確定だが本人通知未送信」（現在 23 件）をエントリーボードでハイライト。据え置き中＝求職者が古い状態を見ている行を CA に気づかせる | 小〜中 | staging 推奨 |

**mypage 側（2回目のプロンプト範囲）**: P2 完了後に `selectionStatus` を求人カードへ描画。P2 は後方互換（フィールド追加のみ）なので、mypage が未対応でも壊れない。

---

## 10. 壊してはいけないもの（この改修で触ると危険な既存挙動）

1. **`entryFlag='求人紹介'` は 100% `isActive=false`**（`resolveEntryIsActive` の条件3「求人紹介段階は全件無効」）。実データでも支援中 108 件すべて `isActive=false`。**`isActive=true` を可視条件に使うと求人紹介行が全部消える**。逆に「isActive=false ＝ 選考終了」と解釈すると求人紹介行が「選考終了」として求職者に出る事故になる。判定は必ず `entryFlag` と併用すること。

2. **`INACTIVE_TRIGGERS` / `resolveEntryIsActive` の運用ルールは確定済み**（`entry-flag-rules.ts` は変更禁止ファイル）。「選考結果そのものでは無効化しない・本人／企業への連絡完了で初めて無効化する」を崩さない。T-157 の据え置きロジックはこのルールに**乗る**設計にすること（新しい無効化条件を足さない）。

3. **`CandidateFile.responseStatus` の一括書き換えは禁止**（§5-3）。`IN_SELECTION`/`SELECTION_ENDED` へ一括投入すると CJR 行が取り残され、マイページ回答タスクの本文が実態とズレる。`UNANSWERED/PENDING` へ落とすと CJR 削除＋タスク更新が全求職者で走り、10分dedup を超えた分の LINE WORKS 通知が大量発火する。**選考状況は導出値として返し、この列は触らない**。

4. **`favorites` GET のレスポンス形**。`sourceJobId` / `sourceType` の「jp形」正規化（`jpNormalize`）に mypage のフルカード表示が依存している。`aiRecommendation` はフェイルクローズで CA 向け選考分析を漏らさない切り出し（`extractRecommendationForDisplay`）。**既存フィールドの意味・null 条件を変えない**。追加のみにすること。

5. **`job-history` API（`/api/internal/candidates/{candidateNumber}/job-history`）**。job-platform の「求職者選択モード」除外フィルタが `jobs[]` / `companyKeys[]` の構造に依存している。同じ突合ロジックを共有したくなるが、**このファイルのレスポンス形は変えない**。ロジックを共通化するなら P1 の純関数を両方から呼ぶ形にする。

6. **`normalizeCompanyKey()` の規則**（`src/lib/company-name-key.ts`）は job-platform `src/lib/ingest/normalize.ts` の複製。**片方だけ変えると同社判定が壊れる**。会社名突合の精度を上げたい場合は、正規化規則ではなく**入力側（`companyName` の前処理）**で吸収すること（§9 P5）。

7. **`createOrUpdateResponseTask()` の advisory lock と全量本文再構築**。過去に「時間窓の差分を全置換して前回本文の求人が消える」バグ、「findFirst→create のレースで二重タスク作成」バグがあり、いずれも修正済み。この関数の呼び出し条件を増やさない（T-157 は呼ぶ必要がない）。

8. **JST 基準の日付処理**。Railway 本番は UTC。`toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })` を使う。`toISOString().slice(0,10)` は禁止（罠 #17）。

9. **`書類見送り` / `entryFlagDetail=''`（空文字）といったマスタ外の値**が実データに存在する。判定式のホワイトリストは実データ基準で作り、`ELSE` 節には必ず安全側のフォールバック（「選考中」等の当たり障りのない表示、または非表示）を置くこと。**未分類で例外を投げない**。

10. **`bulk-import` は `resolveEntryIsActive` を通していない**（`isActive = status !== "終了" && !SELECTION_ENDED_DETAILS.includes(detail)` という別ルール）。FileMaker 再取込が走ると `isActive` の意味が揺れる。T-157 のロジックを `isActive` 単独に依存させないこと（§3-2 の判定式は `personFlag`/`companyFlag`/`entryFlagDetail` を直接見ているので安全）。

---

## 付録: 調査に使ったクエリの母集団定義

| 節 | 母集団 |
|--|--|
| §2-3 | `job_entries.archived_at IS NULL AND entry_date >= '2026-01-01'`（全体 5,144 / 支援中 509） |
| §3-1 | `job_entries.archived_at IS NULL`（全期間・28,513） |
| §3-3, §3-4, §7 | 支援中 × `archived_at IS NULL`（608） |
| §4-2(A) | 支援中 × `archived_at IS NULL` × `entry_flag <> '求人紹介'` × `entry_date >= '2026-01-01'`（457） |
| §4-2(B) | 同上から期間条件を外したもの（500） |
| §4-2(C) | 支援中 × `archived_at IS NULL`（608） |
| §5-1 | `candidate_files.category='BOOKMARK'`（未アーカイブ 6,526 / アーカイブ含む 7,809） |
| §8 | `archived_at IS NULL AND is_active`（全体 294 / 支援中 138。放置指標は `entry_flag <> '求人紹介'` を追加） |

DB アクセスはすべて `SELECT`。UPDATE / INSERT / DELETE / マイグレーションは実行していない。
