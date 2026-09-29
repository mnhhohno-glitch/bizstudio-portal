# T-208（仮） 初回面談の台本モード 調査：台本のボタンと入力画面の欄の対応表

調査日: 2026-09-30 / 対象: bizstudio-portal master（origin/master = 9501462）/ 本番DBは SELECT のみ（選択肢の値の件数だけ。個人情報は取得・記載していない）

## 結論

1. 台本のボタン・入力 121 個のうち、**一致 25／変換で可 52／欄はあるが選択肢に無い 1／欄が無い 43**。欄が無いものの大半（年収の内訳・通勤・職歴の中身・転勤の将来）は、既存の「〇〇メモ」欄に決まった書式で書けば入る。
2. 選択肢の追加が必要なのは **自動車免許「AT限定」だけ**。画面の選択肢は `InterviewForm.tsx` の中に直書きされており、**変更禁止ファイル（`candidate-flags.ts`）には依存していない**ので追加できる。
3. **DB列はあるのに画面に出ていない欄が4つ**ある（在職状況 `employment_status`・退職日 `resignation_date`・年間休日 `desired_holiday_count`・大事にしたい条件 `priority_condition_1〜3`。本番ではほぼ全件 null）。画面に出せば新しい列を足さずに入る。
4. 注意: 画面の選択肢と AI 解析（`candidate-flags.ts`）の選択肢が食い違っていて、**本番の最新面談の多くが「画面の選択肢に無い値」を持っている**（例: 他AG状況「現在も利用中」127件、Typing「見ながら両手打ち可」237件）。台本がどちらの言葉で書くかを先に決める必要がある（推奨は画面側に両方の値を並べる）。
5. 台本の答えの保存先は **新しい表（面談1件に1行・答えは JSON）を推奨**。欄への反映は「空欄だけ埋める」＋「上書きになるときは確認」にする。T-207（案内メール）は master にあるが**本番デプロイは QUEUED（未反映）**。面談準備の質問には会社の情報が無く、名前一致での振り分けは 27% しか当たらないため、整理の形に `company` を足すのが確実。

---

## 2. 対応表（最重要）

判定のルール
- **一致**: 選択肢に同じ文字列がある。文字・数値の入力は、意味が同じ欄（メモ欄を含む）がある。
- **変換で可**: 近い選択肢に置き換えれば入る（置き換え先を記載）。ボタンの文言そのものは、同じ行のメモ欄に残す案を併記。
- **選択肢に無い**: 欄はあるが選択肢が足りない。
- **欄が無い**: 専用の欄が無い。入れ先の案を記載（「→メモ」は既存のメモ欄に書く案、「DB列あり」は列はあるが画面に出ていないもの）。

保存先の表記: `d.` = `interview_details`（InterviewDetail）、`wh.` = `work_histories`（WorkHistory、会社ごと）、`r.` = `interview_records`（InterviewRecord）。

### エージェント利用経験 → `d.agentUsageFlag`（選択肢: 初めて利用／他社利用中／利用経験あり）

| # | ボタン・入力 | 判定 | 入れ先・置き換え先 |
|--|--|--|--|
| 1 | 初めて | 変換で可 | 初めて利用 |
| 2 | 使ったが途中でやめた | 変換で可 | 利用経験あり |
| 3 | 今も並行して使っている | 変換で可 | 他社利用中 |
| 4 | 大手 | 欄が無い | → `d.agentUsageMemo`（例「大手」） |
| 5 | それ以外 | 欄が無い | → `d.agentUsageMemo` |

### 応募書類の状況 → `d.documentStatusFlag`（アクションタブ。選択肢: 未着手／本人作成中／書類サポート中／完成）

| # | ボタン | 判定 | 置き換え先 |
|--|--|--|--|
| 6 | できている | 変換で可 | 完成 |
| 7 | 手書き・途中 | 変換で可 | 本人作成中（「手書き」は `d.documentStatusMemo`） |
| 8 | まだ | 変換で可 | 未着手 |

### 在職・退職の予定

| # | ボタン・入力 | 判定 | 入れ先の案 |
|--|--|--|--|
| 9 | 在職中 | 欄が無い（DB列あり） | `d.employmentStatus`（画面に無い・本番は null 400件／「卒業」5件の誤入力のみ）。画面に出すか、`d.jobChangeTimelineMemo` |
| 10 | 辞めている | 欄が無い（DB列あり） | 同上 |
| 11 | 退職の予定 決まっている | 欄が無い | → `d.jobChangeTimelineMemo` |
| 12 | 退職の予定 決まっていない | 欄が無い | → `d.jobChangeTimelineMemo` |
| 13 | 退職できるまでの月数（文字） | 欄が無い | → `d.jobChangeTimelineMemo` |
| 14 | 退職した時期（文字） | 欄が無い（DB列あり） | `d.resignationDate`（DateTime・画面に無い）。文字のままなら `d.jobChangeTimelineMemo` |

### 転職時期 → `d.jobChangeTimeline`（選択肢: すぐにでも／3カ月以内／半年以内／1年以内／未定）

| # | ボタン・入力 | 判定 | 置き換え先 |
|--|--|--|--|
| 15 | 3ヶ月以内 | 変換で可 | 3カ月以内（「ヶ」と「カ」の表記違い） |
| 16 | 3〜6ヶ月 | 変換で可 | 半年以内 |
| 17 | 半年以上・良いところがあれば | 変換で可 | 未定（「1年以内」とも取れる。AI 解析は「情報収集」を使う） |
| 18 | 希望の月（文字） | 一致 | `d.jobChangeTimelineMemo` |

### 活動期間 → `d.activityPeriod`（選択肢: 1週間以内／1カ月以内／3カ月以内／半年以内／半年以上）

| # | ボタン | 判定 | 置き換え先 |
|--|--|--|--|
| 19 | 始めたばかり | 変換で可 | 1週間以内 |
| 20 | 1〜3ヶ月 | 変換で可 | 3カ月以内 |
| 21 | 3ヶ月以上 | 変換で可 | 半年以内（3〜6か月の意味。区切りがずれるので `d.activityPeriodMemo` に原文） |

### 応募の状況

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 22 | 社数（数値） | 一致 | `d.currentApplicationCount` |
| 23 | 選考中の有無 | 変換で可 | `d.applicationTypeFlag`：有→「選考中」／無→「なし」（選択肢: 検討中／応募中／選考中／なし） |
| 24 | 内定の有無 | 欄が無い | → `d.applicationMemo` |
| 25 | 選考中の業界（文字） | 一致 | `d.applicationMemo` |

### 最終学歴

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 26 | 学校名 | 一致 | `d.educationMemo` |
| 27 | 学部学科 | 一致 | `d.educationMemo`（学校名と続けて書く） |
| 28 | 卒業年（確認） | 一致 | `d.graduationDate`（文字。例「2016年3月」）。卒業区分 `d.graduationStatus` は台本に無い |

※ 学歴の区分 `d.educationFlag`（大学卒／大学院卒／短大卒／専門卒／高卒）は台本にボタンが無い。学校名から自動判定はしない方がよい（CA が選ぶ）。

### 職歴（会社ごと）→ `wh.*`（1社1行）

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 29 | 選んだ理由 | 欄が無い | → `wh.jobTypeMemo`（見出し「【選んだ理由】」付き） |
| 30 | 仕事の中身 | 一致 | `wh.jobTypeMemo`（職種の下のテキスト欄） |
| 31 | 立場 | 欄が無い | → `wh.jobTypeMemo` |
| 32 | 人数 | 欄が無い | → `wh.jobTypeMemo`（会社の規模なら `wh.businessContent`＝会社概要） |
| 33 | 数字 | 欄が無い | → `wh.jobTypeMemo` |

### 退職理由（会社ごと）→ `wh.resignReasonLarge / Medium / Small`（3段の選択。定義は `src/constants/resign-reason-hierarchy.ts`＝変更可）

| # | ボタン | 判定 | 置き換え先（大 / 中 / 小） |
|--|--|--|--|
| 34 | 人間関係 | 変換で可 | 過去型 / 個人都合 / 上司・同僚との人間関係（ハラスメントなら「ハラスメント（パワハラ・セクハラ等）」） |
| 35 | 残業・仕事量 | 変換で可 | 過去型 / 個人都合 / 長時間労働・過重労働（または「残業や休日出勤が多い」） |
| 36 | 給与・評価 | 変換で可 | 過去型 / 個人都合 / 給与・待遇が見合わない（評価なら「評価制度への不満」「昇給・昇進がない」） |
| 37 | 通勤・家庭の事情 | 変換で可 | 過去型 / 環境要因 / 「通勤時間が長い・転居により通勤困難」または「家庭の事情（育児・介護）」 |
| 38 | 将来・成長 | 変換で可 | 未来型 / キャリア志向 / より成長できる環境を求めて |
| 39 | 仕事内容が合わない | 変換で可 | 過去型 / 個人都合 / 仕事内容が合わない・ギャップがある |
| 40 | 言いにくい | 欄が無い | 選択は空のまま → `wh.jobChangeReasonMemo`（「言いにくい」と記録） |

※ 34〜37 は小分類の候補が2つ以上ある。台本では「大・中」まで自動で入れ、小分類は候補を絞って CA に選ばせる案が安全。

### 職種 → `d.desiredJobTypes`（職種マスタから最大3つ選ぶ。`/api/job-categories/all`）

| # | ボタン・入力 | 判定 | 入れ先 |
|--|--|--|--|
| 41 | ある | 欄が無い | 保存不要（次の質問に進むための分岐） |
| 42 | まだ分からない | 変換で可 | マスタの「指定なし」（`enableUnspecifiedExclusive` で他と排他） |
| 43 | 生かしたい | 欄が無い | → `d.desiredJobType1Memo` |
| 44 | 挑戦したい | 欄が無い | → `d.desiredJobType1Memo` |
| 45 | どちらとも言えない | 欄が無い | → `d.desiredJobType1Memo` |
| 46 | 希望職種（文字） | 変換で可 | マスタから選び直す（文字は `d.desiredJobType1Memo` にも残す）。自動でマスタに当てるのは不確実 |
| 47 | 避けたい職種（文字） | 欄が無い | → `d.desiredJobType1Memo` |

### 業種 → `d.desiredIndustries`（業種マスタから最大3つ）

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 48 | 希望業種（文字） | 変換で可 | マスタから選ぶ（文字は `d.desiredIndustry1Memo`） |
| 49 | 避けたい業種（文字） | 欄が無い | → `d.desiredIndustry1Memo` |

### 勤務地 → `d.desiredAreas`（エリアマスタ 最大5つ）

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 50 | 希望エリア（文字） | 変換で可 | マスタから選ぶ（文字は `d.desiredAreaMemo`） |
| 51 | 最寄り駅 | 欄が無い | → `d.desiredAreaMemo` |
| 52 | 電車 | 欄が無い | → `d.desiredAreaMemo` |
| 53 | 車 | 欄が無い | → `d.desiredAreaMemo` |
| 54 | 通勤時間 | 欄が無い | → `d.desiredAreaMemo` |
| 55 | 引っ越しの有無 | 欄が無い | → `d.desiredAreaMemo`（転勤と関係するなら `d.desiredTransferMemo`） |

### 年収（単位はすべて万円・整数）

| # | 入力 | 判定 | 入れ先 |
|--|--|--|--|
| 56 | 現年収 | 一致 | `d.currentSalary` |
| 57 | 賞与の有無と年額 | 欄が無い | → `d.currentSalaryMemo` |
| 58 | 月給（自動計算） | 欄が無い | → `d.currentSalaryMemo` |
| 59 | 手取り（自動計算） | 欄が無い | → `d.currentSalaryMemo` |
| 60 | 残業代込みか／何時間分 | 欄が無い | → `d.currentSalaryMemo` |
| 61 | 交通費を含まないか | 欄が無い | → `d.currentSalaryMemo` |
| 62 | 最低希望年収 | 一致 | `d.desiredSalaryMin`（画面名「希望下限」） |
| 63 | 希望の月手取り | 欄が無い | → `d.desiredSalaryMinMemo` |
| 64 | 理想の年収と月給 | 一致 | 年収は `d.desiredSalaryMax`（画面名「希望年収」）、月給は `d.desiredSalaryMaxMemo` |

### 休日 → `d.desiredDayOff`（選択肢: 土日祝休み／完全週休2日／シフト制／曜日問わず）

| # | ボタン・入力 | 判定 | 置き換え先 |
|--|--|--|--|
| 65 | 土日祝 | 変換で可 | 土日祝休み |
| 66 | シフト制・平日休みでもよい | 変換で可 | シフト制 |
| 67 | こだわらない | 変換で可 | 曜日問わず |
| 68 | 年間休日の日数 | 欄が無い（DB列あり） | `d.desiredHolidayCount`（文字列・画面に無い・本番は全件 null）。出さないなら `d.desiredDayOffMemo` |

### 残業 → `d.desiredOvertimeMax`（選択肢: 絶対不可／10時間以内／20時間以内／30時間以内／45時間以内）

| # | ボタン・入力 | 判定 | 置き換え先 |
|--|--|--|--|
| 69 | 月の時間（自動計算） | 変換で可 | 0→絶対不可、〜10→10時間以内、〜20→20時間以内、〜30→30時間以内、〜45→45時間以内。**45時間超は選択肢が無い**（本番に「40時間以内」2件など画面外の値もある）。数値は `d.desiredOvertimeMemo` |
| 70 | 固定残業代［可能］ | 欄が無い | → `d.desiredOvertimeMemo` |
| 71 | 固定残業代［紹介不可］ | 変換で可 | 働き方のチェック「固定残業NG」を ON |

### 転勤 → `d.desiredTransfer`（選択肢: なし／可／要相談）

| # | ボタン・入力 | 判定 | 置き換え先 |
|--|--|--|--|
| 72 | 事務：大丈夫 | 変換で可 | 可 |
| 73 | 事務：難しい | 変換で可 | なし |
| 74 | 全国OK | 変換で可 | 可 |
| 75 | エリア限定ならOK | 変換で可 | 要相談（エリアは `d.desiredTransferMemo`） |
| 76 | 通える範囲ならOK | 変換で可 | なし（転居を伴う転勤なし。「通える範囲なら可」を `d.desiredTransferMemo`）※「要相談」とも取れるので要決定 |
| 77 | 難しい | 変換で可 | なし |
| 78 | エリア（文字） | 一致 | `d.desiredTransferMemo` |
| 79 | 将来ならOK | 欄が無い | → `d.desiredTransferMemo` |
| 80 | 将来も難しい | 欄が無い | → `d.desiredTransferMemo` |

### 自動車免許 → `d.driverLicenseFlag`（選択肢: 取得／未取得／取得予定）

| # | ボタン | 判定 | 置き換え先 |
|--|--|--|--|
| 81 | AT限定 | **選択肢に無い** | 「取得(AT限定)」を画面の選択肢に追加（`InterviewForm.tsx` 直書き＝変更可。`candidate-flags.ts` には既にあり、本番にも47件ある） |
| 82 | MT | 変換で可 | 取得 |
| 83 | 持っていない | 変換で可 | 未取得 |
| 84 | 日常的に運転する | 欄が無い | → `d.driverLicenseMemo` |
| 85 | ペーパードライバー | 欄が無い | → `d.driverLicenseMemo` |

### 語学 → `d.languageSkillFlag`（選択肢: 不可／日常会話／ビジネス／ネイティブ）

| # | ボタン・入力 | 判定 | 置き換え先 |
|--|--|--|--|
| 86 | なし | 変換で可 | 不可 |
| 87 | 日常会話 | 一致 | 日常会話 |
| 88 | ビジネスで使える | 変換で可 | ビジネス |
| 89 | 資格あり | 欄が無い | → `d.languageSkillMemo`（資格名） |
| 90 | 点数 | 欄が無い | → `d.languageSkillMemo` |

※ 何語か（英語・中国語など）は台本に無い。メモに書く。

### PCスキル

| # | ボタン | 判定 | 置き換え先 |
|--|--|--|--|
| 91 | タイピング：見ずに打てる | 変換で可 | `d.typingFlag` = ブラインドタッチ可 |
| 92 | タイピング：見ながらなら打てる | 変換で可 | 中級（本番では AI 由来の「見ながら両手打ち可」が237件あるが画面の選択肢に無い） |
| 93 | タイピング：苦手 | 変換で可 | 初級 |
| 94 | Excel：ほぼ使わない | 変換で可 | `d.excelFlag` = 不可 |
| 95 | Excel：入力だけ | 変換で可 | 初級 |
| 96 | Excel：SUMなど簡単な計算 | 変換で可 | 初級（5段階を4段階に寄せるため。原文は `d.excelMemo`） |
| 97 | Excel：VLOOKUP・IFも使える | 変換で可 | 中級 |
| 98 | Excel：ピボットテーブルも使える | 変換で可 | 上級 |
| 99 | Word・PPT：どちらも問題ない | 変換で可 | `d.wordFlag` = 中級、`d.pptFlag` = 中級 |
| 100 | Word・PPT：Wordだけ | 変換で可 | Word 中級 / PPT 不可 |
| 101 | Word・PPT：PowerPointだけ | 変換で可 | Word 不可 / PPT 中級 |
| 102 | Word・PPT：どちらも苦手 | 変換で可 | Word 初級 / PPT 初級 |

### 働き方 → `d.workStylePreferences`（チェック。JSON 配列の文字列で保存）

| # | ボタン | 判定 | 入れる値 |
|--|--|--|--|
| 103 | フルリモート | 一致 | フルリモート |
| 104 | ハイブリッド | 一致 | ハイブリッド |
| 105 | フレックス | 変換で可 | フレックス勤務 |
| 106 | 上場企業 | 一致 | 上場企業 |
| 107 | スタートアップ | 一致 | スタートアップ |
| 108 | 住宅手当 | 一致 | 住宅手当 |
| 109 | 退職金 | 変換で可 | 退職金制度 |
| 110 | 賞与必須 | 一致 | 賞与必須 |
| 111 | 固定残業NG | 一致 | 固定残業NG |
| 112 | 海外勤務・出張あり | 一致 | 海外勤務・出張あり |
| 113 | 海外常駐希望 | 一致 | 海外常駐希望 |
| 114 | 英語を使う仕事 | 一致 | 英語を使う仕事 |
| 115 | 特になし | 欄が無い | 何もチェックしない（「聞いたが無し」と「未確認」を分けたいなら台本の答えの記録側に持つ） |

### 大事にしたい条件・連絡手段・次回面談

| # | ボタン・入力 | 判定 | 入れ先 |
|--|--|--|--|
| 116 | 大事にしたい条件 3つ（文字） | 欄が無い（DB列あり） | `d.priorityCondition1〜3`（画面に無い・本番は全件 null）。出さないなら `d.priorityConditionMemo` も同様に非表示のため、`d.desiredJobType1Memo` 等ではなく画面に出すのを推奨 |
| 117 | 連絡手段：LINE | 一致 | `d.contactMethod` = LINE（アクションタブ。選択肢: LINE／メール／電話） |
| 118 | 連絡手段：メール | 一致 | `d.contactMethod` = メール（→ T-207 の案内メール送信と連動、4章） |
| 119 | 次回面談：日時 | 一致 | `d.nextInterviewDate`（DateTime）＋ `d.nextInterviewTime`（"HH:MM"）。あわせて `d.nextInterviewFlag` = 設定済 |
| 120 | 次回面談：電話 | 欄が無い | → `d.nextInterviewMemo`（面談の手法 `r.interviewTool` は今回の面談の欄） |
| 121 | 次回面談：オンライン | 欄が無い | → `d.nextInterviewMemo` |

### 集計

| 判定 | 件数 |
|--|--|
| 一致 | 25 |
| 変換で可 | 52 |
| 欄はあるが選択肢に無い | 1（自動車免許 AT限定） |
| 欄が無い | 43（うち DB列はあるが画面に無い: 在職2・退職時期1・年間休日1・大事にしたい条件1 ＝5。保存不要: 「ある」「特になし」＝2） |
| 合計 | 121 |

---

## 1. 面談記録の入力画面の全項目

画面: `src/components/candidates/InterviewForm.tsx`（2096行）。**選択肢はすべてこのファイルの中に直書き**（`options={[...]}`）。例外は退職理由（`src/constants/resign-reason-hierarchy.ts`）と、職種・業種・エリア（DBのマスタを API から取得）。どちらも変更禁止ファイルではない。

### 1-1. 面談基本情報（左カラム上）

| 画面の名前 | 保存先 | 種類 | 選択肢 |
|--|--|--|--|
| 面談日 | `r.interviewDate` | 日付 | — |
| 時刻（開始・終了） | `r.startTime` / `r.endTime` | 時刻（文字 "HH:MM"） | — |
| 時間/手法 | 時間は `r.duration`（表示のみ）／手法 `r.interviewTool` | 選択 | 電話／オンライン／対面 |
| 求職者ID・氏名・フリガナ・生年月日・電話・メール・年齢/性別・住所・担当CA・担当 | `candidates` 等（表示のみ） | — | — |
| ランク/最新 | `interview_ratings.overallRank`（表示のみ） | — | — |
| 回数/状態 | `r.interviewCount`・`r.status`（draft=下書き／complete=入力済） | 表示 | — |
| 結果 | `r.resultFlag` | 選択 | 面談前／求人紹介 送付前／求人紹介 送付済／継続／保留／日程再調整／連絡なし辞退／連絡あり辞退／支援終了_当社判断／支援終了_本人希望 |
| フラグ | `candidates.supportStatus / supportSubStatus`（表示のみ） | — | — |

### 1-2. 転職活動状況（左カラム）

| 画面の名前 | 保存先 | 種類 | 選択肢 |
|--|--|--|--|
| 他AG状況 | `d.agentUsageFlag` ＋ メモ `d.agentUsageMemo` | 選択＋文字 | 初めて利用／他社利用中／利用経験あり |
| 転職時期 | `d.jobChangeTimeline` ＋ `d.jobChangeTimelineMemo` | 選択＋文字 | すぐにでも／3カ月以内／半年以内／1年以内／未定 |
| 活動期間 | `d.activityPeriod` ＋ `d.activityPeriodMemo` | 選択＋文字 | 1週間以内／1カ月以内／3カ月以内／半年以内／半年以上 |
| 他社応募 | `d.applicationTypeFlag` ＋ `d.applicationMemo` ＋ 社数 `d.currentApplicationCount` | 選択＋文字＋数値 | 検討中／応募中／選考中／なし |
| 最終学歴 | `d.educationFlag` ＋ `d.educationMemo` ＋ 卒業年月 `d.graduationDate`（文字）＋ `d.graduationStatus` | 選択＋文字＋文字＋選択 | 学歴: 大学卒／大学院卒／短大卒／専門卒／高卒。区分: 卒業／卒業予定／在学中／中退／修了／その他 |

### 1-3. 職務経歴（左カラム・会社ごと。`work_histories` に1社1行、`order` で並ぶ）

| 画面の名前 | 保存先 | 種類 | 選択肢 |
|--|--|--|--|
| 企業名 | `wh.companyName` | 文字 | — |
| 在籍（年・月） | `wh.tenureYear` / `wh.tenureMonth` | 数値 | — |
| 会社概要 | `wh.businessContent` | 文字 | — |
| 職種（1行＋テキスト欄） | `wh.jobTypeFlag`（文字・選択ではない）＋ `wh.jobTypeMemo` | 文字 | — |
| 退社理由（大・中・小） | `wh.resignReasonLarge / Medium / Small` | 選択（3段） | `resign-reason-hierarchy.ts`：大=過去型／未来型、中=会社都合・個人都合・環境要因／キャリア志向・働き方の見直し・将来設計、小=中ごとに4〜11個 |
| 詳細 | `wh.jobChangeReasonMemo` | 文字 | — |

※ 1社目の内容は保存時に `d.companyName` 等にも写される（`buildAutosaveBody`）。`wh.hireDate / leaveDate` は画面に無い。

### 1-4. 右カラム「初期条件」タブ

登録時条件 `d.regIndustry1/2`・`d.regJobType1/2`・`d.regAreaPrefecture`（文字）、`d.regEmploymentType`（選択: 正社員／契約社員／派遣）、`d.regSalaryMin/Max`（数値）。
メモ: `interview_memos`（1面談に複数。タイトル・フラグ〔初回面談／既存面談／面接対策／内定面談／その他〕・日付・時刻・本文）。

### 1-5. 右カラム「希望条件」タブ

| 画面の名前 | 保存先 | 種類 | 選択肢 |
|--|--|--|--|
| 職種 | `d.desiredJobTypes`（JSON 配列・最大3）＋先頭を `d.desiredJobType1` に写す＋メモ `d.desiredJobType1Memo` | マスタ選択＋文字 | `/api/job-categories/all`（大・中・小）。「指定なし」は他と排他 |
| 業種 | `d.desiredIndustries`（最大3）＋ `d.desiredIndustry1` ＋ `d.desiredIndustry1Memo` | 同上 | `/api/industry-categories/all` |
| エリア | `d.desiredAreas`（最大5。`{area, prefecture, city}`）＋ `d.desiredArea/Prefecture/City` ＋ `d.desiredAreaMemo` | 同上 | `/api/area-categories/all` |
| 現年収 | `d.currentSalary`（万円・整数）＋ `d.currentSalaryMemo` | 数値＋文字 | — |
| 希望下限 | `d.desiredSalaryMin` ＋ `d.desiredSalaryMinMemo` | 数値＋文字 | — |
| 希望年収 | `d.desiredSalaryMax` ＋ `d.desiredSalaryMaxMemo` | 数値＋文字 | — |
| 希望休日 | `d.desiredDayOff` ＋ `d.desiredDayOffMemo` | 選択＋文字 | 土日祝休み／完全週休2日／シフト制／曜日問わず |
| 希望残業 | `d.desiredOvertimeMax` ＋ `d.desiredOvertimeMemo` | 選択＋文字 | 絶対不可／10時間以内／20時間以内／30時間以内／45時間以内 |
| 転勤有無 | `d.desiredTransfer` ＋ `d.desiredTransferMemo` | 選択＋文字 | なし／可／要相談 |
| 自動車免許 | `d.driverLicenseFlag` ＋ メモ | 選択＋文字 | 取得／未取得／取得予定 |
| 語学 | `d.languageSkillFlag` ＋ メモ | 選択＋文字 | 不可／日常会話／ビジネス／ネイティブ |
| 日本語 | `d.japaneseSkillFlag` ＋ メモ | 選択＋文字 | ネイティブ／ビジネス／日常会話 |
| Typing | `d.typingFlag` ＋ メモ | 選択＋文字 | ブラインドタッチ可／中級／初級 |
| Excel / Word / PPT | `d.excelFlag` / `d.wordFlag` / `d.pptFlag` ＋ 各メモ | 選択＋文字 | 中級／上級／初級／不可 |
| 働き方（チェック12個） | `d.workStylePreferences`（JSON 配列の文字列） | チェック | フルリモート／上場企業／退職金制度／海外勤務・出張あり／ハイブリッド／スタートアップ／固定残業NG／海外常駐希望／フレックス勤務／住宅手当／賞与必須／英語を使う仕事（`WORK_STYLE_OPTIONS`） |

### 1-6. 右カラム「アクション」タブ

| 画面の名前 | 保存先 | 種類 | 選択肢 |
|--|--|--|--|
| 書類状況 | `d.documentStatusFlag` ＋ メモ | 選択＋文字 | 未着手／本人作成中／書類サポート中／完成 |
| サポート | `d.documentSupportFlag` ＋ メモ | 選択＋文字 | マイナビWEB履歴書から作成／本人作成書類から作成／ヤギッシュ作成依頼／テンプレ送付のみ |
| 連絡手段 | `d.contactMethod` ＋ `d.contactMemo` | 選択＋文字 | LINE／メール／電話 |
| 送付予定 | `d.jobReferralFlag` ＋ `d.jobReferralMemo` | 選択＋文字 | 送付予定／送付なし |
| 次回面談 | `d.nextInterviewFlag` ＋ `d.nextInterviewDate`（日付）＋ `d.nextInterviewTime` ＋ `d.nextInterviewMemo` | 選択＋日付＋時刻＋文字 | 設定済／調整中／未設定 |
| ネクストアクション | `d.nextAction`（空なら freeMemo / initialSummary / summaryText を表示） | 文字 | — |

ランク評価タブ（`interview_ratings`）・添付タブ・面談サポートタブ（非表示中）は台本の対象外。

### 1-7. DB列はあるが画面に出ていない欄（台本で使える）

| 列 | 型 | 本番の最新面談での状況 |
|--|--|--|
| `d.employmentStatus`（employment_status） | 文字 | null 400／「卒業」5（誤入力） |
| `d.resignationDate`（resignation_date） | DateTime | 画面なし（保存 API は日付の整形に対応済み） |
| `d.desiredHolidayCount`（desired_holiday_count） | 文字 | 全件 null |
| `d.priorityCondition1〜3`・`d.priorityConditionMemo` | 文字 | 全件 null |
| `d.desiredEmploymentType`・`d.desiredJobType2`・`d.jobChangeAxisFlag/Memo`・`d.companyFeatureFlags`・`d.workStyleFlags`・`d.lineSetupFlag` 等 | 文字 | 台本では不使用 |

### 1-8. 選択肢の定義ファイルと変更禁止

| 定義 | 使われ方 | 変更 |
|--|--|--|
| `InterviewForm.tsx` の直書き | **画面の選択肢**（上表すべて） | 可 |
| `src/constants/resign-reason-hierarchy.ts` | 退職理由の3段 | 可 |
| 職種・業種・エリアのマスタ（DB） | 希望条件の選択 | DB（今回は触らない） |
| `src/constants/candidate-flags.ts` | **AI 解析**（`/api/interviews/analyze`・`flag-list-schema.ts`）の選択肢。画面は参照していない | **変更禁止**（読むだけ） |

**画面と AI の選択肢の食い違い（台本の前に決めること）**
本番の最新面談（FileMaker 取り込みを除く 554件中、詳細あり405件）の値の分布を見ると、AI 解析が `candidate-flags.ts` の言葉で書き込んだ値が多く、**画面の選択肢に無いため選択欄では「-」に見える**状態のものがある。

| 欄 | 画面の選択肢に無い値（件数） |
|--|--|
| 他AG状況 | 現在も利用中 127／過去に利用有 49 |
| 転職時期 | 情報収集 3 |
| 他社応募 | 応募なし 126／応募済み 33 |
| 最終学歴 | 短大・専門卒 55／高校卒 29 |
| 希望休日 | 問わず 9 |
| 希望残業 | 40時間以内 2 |
| 転勤 | あり 31 |
| 自動車免許 | 取得(AT限定) 47／無し 34 |
| 日本語 | 資格未取得_ネイティブレベル 306／－ 64 ほか |
| Typing | 見ながら両手打ち可 237／片手打ちレベル 3 |
| 書類状況 | 作成済 182／作成途中 53 |

台本モードは画面の言葉で書くのが自然（CA が見て直せる）。あわせて、画面の選択肢に AI 側の値も並べる（または読み込み時に言い換える）対応を別チケットで行うのが望ましい。どちらも `InterviewForm.tsx` 側の変更で済み、変更禁止ファイルには触れない。

---

## 3. 保存の仕組み

### 3-1. 今の保存の流れ

- **作成**: `POST /api/interviews`（`src/app/api/interviews/route.ts`）。`status` は既定 `draft`、`isLatest=true` で作り、同じ求職者の他の面談を `isLatest=false` にする。2回目以降は前回の `interview_details`・評価・メモを**丸ごと写して**作る（`copyFromPreviousInterview`）。
- **自動保存**: 画面で値を変えると `isDirty` → 3秒後に `PATCH /api/interviews/[id]/autosave`。`buildAutosaveBody` が **画面が持っている detail 全体**を送り、API は `interview_details` を upsert（送られた列を上書き）。職歴は別に `PUT /api/interviews/[id]/work-histories`（全件置き換え）。
- **競合**: `autosaveToken` で別セッションの更新を検知し 409（画面は「リロードしてください」）。
- **下書き／入力済**: `r.status` の `draft`／`complete`。完了操作で `complete` にする。localStorage には保存失敗時の退避だけ。
- **最新フラグ**: `r.isLatest`。一覧・AI・評価は最新面談を読む。削除時は1つ前の面談を最新に戻す。
- **既存の自動入力（AI 解析 `analyze-with-intake`）**: 返ってきた `detailUpdates` を `{...prev, ...detailUpdates}` で**上書き**している。空欄だけ埋める仕組みは今は無い。

### 3-2. 台本の答えの保存先の案

| 案 | 中身 | 良い点 | 悪い点 |
|--|--|--|--|
| A. `interview_details` に列を足す（例 `script_answers Json?`） | 面談記録の横に JSON 1列 | 読み込みが1回で済む。面談の作成・写しに自然に乗る | 2回目の面談作成時に**前回の答えまで写される**（`copyFromPreviousInterview` が detail を丸ごと写す）。詳細表は既に約120列で肥大。自動保存が detail 全体を送るので、画面の古い状態で上書きされる競合も起きやすい |
| B. 新しい表 `interview_script_answers`（面談1件に1行。`interview_record_id` unique、`answers Json`、`script_version`、`updated_by`、時刻） | 台本専用 | 自動保存（detail 丸ごと送信）と独立。台本の改訂を `script_version` で区別できる。写しの対象外なので2回目に持ち越さない。純粋追加（nullable 不要・既存に影響なし） | 読み込みが1回増える。表が1つ増える |
| C. 面談メモ `interview_memos` に文章で書く | 既存の仕組み | 追加なし | 機械で読み直せない（面談準備チャットに渡す・次回台本で使う、ができない） |

**推奨は B**。答え（ボタンの原文）は B に残し、欄には「変換後の値」を入れる。こうすると欄を CA が直しても、何を押したかは B に残り、面談準備チャットや集計にそのまま使える。

### 3-3. CA がすでに入力した値を上書きしない方法の案

1. **空欄だけ埋める（既定）**: 反映先の値が `null`／空文字／空配列のときだけ入れる。メモ欄は「空なら入れる、入っていれば末尾に `【台本】…` を追記（同じ文がすでにあれば足さない）」。
2. **上書きになる選択は確認する**: 選択欄に別の値が入っているときは自動では替えず、欄の横に「台本: 3カ月以内 に替える？」の小さな提案を出す（CA が押したら替える）。
3. **誰が入れたかを持つ**: B の表に「どの欄に何を入れたか（`applied: {field: value}`）」を持つ。台本のボタンを押し直したとき、**欄の値が前回台本が入れた値のままなら**差し替え、CA が手で変えていたら触らない。
4. **2回目以降の面談**: 前回から写された値は「CA が入れた値」と同じ扱い（空欄ではないので 1 により上書きしない）。
5. 反映は画面の state（`setDetailState`）に入れて、既存の自動保存で保存する。サーバーで直接 detail を書くと、開いている画面の古い state の自動保存で消されるため避ける。

---

## 4. 関連機能の状態

### 4-1. 案内メール（T-207）

- コード: master にあり（`9501462` 2026-09-30 01:27）。**本番デプロイは QUEUED のまま（01:38 時点）**で、移行 `20260930100000_t207_candidate_contact_mail` は本番DBに未適用（`candidate_contact_mail_logs` 表がまだ無い）。反映待ち。
- API: `src/app/api/candidates/[candidateId]/contact-mail/route.ts`
  - `GET`（type 無し）: メニュー用に `{ candidate, sender:{email,name,familyName,from}, items:{ line|greeting: {canSend, reason, lastSentAt} } }`
  - `GET ?type=line|greeting`: 上に加えて差し込み済みの `preview`（件名・本文）
  - `POST { type: "line"|"greeting", resend?: boolean }`: 送信。送れない理由は 400（`code: cannot_send`）、同じ種類の送信記録があり `resend` でなければ 409（`already_sent`）、送信失敗 502。成功は `{ ok, type, logId, messageId, sentAt }`
  - 認証はセッション（未ログイン 403）
- 画面: `CandidateContactMailButton.tsx`（面談画面のヘッダーから利用）。台本の「連絡手段：メール」を押したらこのボタンの確認画面を開く形にすれば、二重送信防止（409）もそのまま効く。

### 4-2. 面談準備チャットに台本の答えを渡す方法

送る中身（`src/lib/interview-prep/chat.ts`）:
- system = ［指示本文］［レジュメ］［調べた情報］（それぞれ `cache_control`）
- messages = ［固定文→最初の整理］［直近10往復］［今回の質問（`cache_control`）］

**案: 今回の質問の文の先頭に「【台本で分かったこと】転職時期: 3カ月以内 …」を付ける**（`buildChatMessages` の最後の user メッセージ）。
- system や最初の整理に入れると、答えが変わるたびに前の部分の byte が変わり、キャッシュが全部作り直しになる（罠#39）。
- 最後の質問に付ければ、前の部分（system＋履歴）は変わらないのでキャッシュはそのまま読み出しになる。
- 履歴に残る分は次の往復でも同じ文字列なので問題ない。付ける文は B の表から決まった順・決まった書式で組み立てる（同じ答えなら同じ byte）。

### 4-3. 面談準備の質問を会社ごとに振り分けられるか

- `summary_json.questions` の1件は `{ question, why, reveals, mismatch }` だけで、**どの会社の話かの情報は無い**（`src/lib/interview-prep/summary-format.ts`）。会社名があるのは `works[].company` と `timeline[].title`。
- 本番の有効な部屋14件・質問73件で、質問文に `works` の会社名（法人格を除いた名前・先頭4文字）が含まれていたのは **20件（27%）**、うち2社以上に当たったのが3件。`works` が0〜1社の部屋が8件。**名前一致での振り分けは実用にならない**。
- 案:
  1. **整理の形に `company`（または `timelineIndex`）を足す**（推奨）。`SUMMARY_TOOL_INPUT_SCHEMA` の questions に任意項目を足し、`normalizePrepSummary` で `works` の会社名に無い値は「全体」に寄せる。AI への指示が変わるので staging 必須。書き方の変更なので `INTERVIEW_PREP_FORMAT_UPDATED_AT` を更新。古い部屋は「全体」扱い。
  2. 名前一致で当たったものだけ会社に振り、残りは「全体」の欄に出す（AI 変更なし・すぐできるが、7割が全体に落ちる）。

### 4-4. CA の姓とメールアドレスの取り方

- 既に T-207 で共通化済み: `resolveSender(user)`（`src/lib/candidate-mail/send.ts`）
  - 姓: `Employee.name`（`userId` で引く。無ければ `User.name`）を `caFamilyNameOf()`（`src/lib/candidate-mail/templates.ts`）で**最初の空白（半角・全角）より前**を取る
  - メール: ログイン中の `User.email`（差出人にできるのは `@bizstudio.co.jp` のみ）
- 画面側は `GET /api/candidates/[candidateId]/contact-mail` の `sender.familyName / email` で取れる。台本の読み上げ文（「ビズスタジオの〔姓〕です」）にもこれを使えば、メールと表記が揃う。
- 注意: 面談の担当者 `r.interviewerUserId` は **Employee.id**、送信者の `sentByUserId` は **User.id**（取り違え注意）。
