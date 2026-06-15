# T-044 Phase 1 調査報告

## TL;DR

**症状A（OK）と症状B（Cancel）は同一の根本原因**: 自動保存の debounce が 3 秒に設定されており、`router.push` または手動リロードがその 3 秒の間に走ると、`form.resultFlag` の更新が DB に永続化されないままタイマーが kill される。「Cancel 押下後の resultFlag が確実に消える」訳ではなく、**Cancel 後 3 秒以内にリロードすると消える** が正しい。

`window.confirm` のレースは原因ではない。confirm はメインスレッドをブロックするが、State 更新は queued されており Cancel 後に正しく適用されている。

T-028（commit `9264c84`、辞退分割実装）で導入。T-043（commit `4bf031c`、面談日転送）は無関係（params 追記のみ）。

---

## 1. 結果プルダウン onChange 詳細

### 1-1. onChange ブロック実コード（L1136-1158）

```tsx
<div className="col-span-2 flex items-center gap-1.5 min-w-0">
  <span className="shrink-0" style={{ fontSize: 11, color: "var(--im-fg2)", minWidth: 30 }}>結果</span>
  <Fld value={form.resultFlag} onChange={(v) => {
    setField("resultFlag", v);
    if (v === "連絡なし辞退" || v === "連絡あり辞退") {
      const ok = window.confirm("「面談不参加共有」のタスクを作成しますか？");
      if (ok) {
        const name = candidate?.name || "";
        const params = new URLSearchParams({
          prefill: "interview-decline",
          candidateId,
          categoryId: MENDAN_FUSANKA_CATEGORY_ID,
          assigneeId: OKADA_EMPLOYEE_ID,
          title: `面談不参加共有 - ${name}`,
        });
        // T-043: 面談日・時刻を Step 3 の「面談日」フィールドに自動セットするため転送
        if (form.interviewDate) params.set("interviewDate", form.interviewDate);
        if (form.startTime) params.set("startTime", form.startTime);
        router.push(`/tasks/new?${params.toString()}`);
      }
    }
  }} type="select" options={["求人紹介 送付前", "求人紹介 送付済", "対象外", "継続", "保留", "連絡なし辞退", "連絡あり辞退"]} />
</div>
```

### 1-2. setField 実装（L495-499）

```tsx
const setField = (key: string, value: unknown) => {
  setForm((prev) => ({ ...prev, [key]: value }));
  setIsDirty(true);
};
```

resultFlag に対する**特殊処理は一切ない**。単純な state setter + isDirty 立て。

### 1-3. Fld component 実装（L250-301、type="select" 部分）

```tsx
if (type === "select" && options) {
  return (
    <select value={(value as string) || ""} onChange={(e) => onChange(e.target.value)} style={base} className={className} disabled={readOnly}>
      <option value="">-</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
```

完全 controlled component。内部 state なし、`onChange` は `e.target.value` を直接親に伝播。**ここに伝播ロスは無い**。

---

## 2. doAutoSave 実装詳細

### 2-1. 完全コード（L520-611）

```tsx
const doAutoSave = useCallback(async () => {
  if (!interviewId || savingRef.current) return;
  savingRef.current = true;
  setSaveStatus("saving");
  try {
    const r = rating;
    /* ... rating total calc ... */
    const ratingData = { ...cleanRelationFields(r), /* totals */ };
    const detailData = cleanRelationFields(detail);
    /* ... workHistories → detailData mirror ... */

    const res = await fetch(`/api/interviews/${interviewId}/autosave`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interviewDate: form.interviewDate || undefined,
        startTime: form.startTime || undefined,
        endTime: form.endTime || undefined,
        interviewTool: form.interviewTool || undefined,
        interviewType: form.interviewType || undefined,
        resultFlag: form.resultFlag || undefined,        // ← ★ resultFlag は送信される
        interviewMemo: form.interviewMemo || undefined,
        summaryText: form.summaryText || undefined,
        status: forceCompleteRef.current ? "complete" : (form.status || undefined),
        lastEditedBy: currentUser?.id,
        autosaveToken: autosaveToken || undefined,
        detail: Object.keys(detailData).length > 0 ? detailData : undefined,
        rating: Object.keys(ratingData).length > 0 ? ratingData : undefined,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setLastSavedAt(new Date(data.lastSavedAt));
      setAutosaveToken(data.autosaveToken);
    } else if (res.status === 409) {
      toast.error("他のセッションで変更されました。リロードしてください。");
      setSaveStatus("error");
      return;
    } else {
      setSaveStatus("error");
      return;  // ← 500 など silent failure
    }

    /* ... workHistories 別途 PUT ... */
    setIsDirty(false);
    setSaveStatus("saved");
  } catch {
    setSaveStatus("error");
    localStorage.setItem(`interview-draft-${interviewId}`, JSON.stringify({ form, detail, rating }));
  } finally {
    savingRef.current = false;
  }
}, [interviewId, form, detail, rating, workHistories, autosaveToken, currentUser?.id]);
```

### 2-2. resultFlag は保存対象に**含まれている**

- フロント側 body L570: `resultFlag: form.resultFlag || undefined`
- API 側 `src/app/api/interviews/[id]/autosave/route.ts` L49-69 の `allowedRecordFields` に `resultFlag` 含有（L57）
- L65-69 で `body[field] !== undefined` の時のみ更新するパターン → `"連絡なし辞退"` は truthy なので確実に渡る

API 側のロジックも問題なし。**API は resultFlag を確実に DB に書き込む**。

### 2-3. debounce 発火条件（L613-618）

```tsx
useEffect(() => {
  if (!isDirty || !interviewId) return;
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => { doAutoSave(); }, AUTOSAVE_DEBOUNCE);
  return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
}, [isDirty, interviewId, form, detail, rating, workHistories, doAutoSave]);
```

**`AUTOSAVE_DEBOUNCE = 3_000`（L116、3 秒）**。

- isDirty=true で setTimeout 発火、3 秒後に doAutoSave
- deps の form/detail/rating/workHistories のいずれかが変わると useEffect 再走 → cleanup でタイマー kill → 新 setTimeout
- **戻り値 cleanup の clearTimeout は、コンポーネント unmount 時にも走る** → unmount すると保存処理が消える

---

## 3. window.confirm レース挙動

### 3-1. JavaScript 仕様

`window.confirm()` は modal で **メインスレッドを完全停止**。React 状態更新は queue され、confirm 閉鎖後に flush される。setTimeout も confirm 中はカウントが進まない（一部ブラウザでは進むが解決は confirm 後）。

### 3-2. 実際の挙動推定

#### Cancel 時の正しい挙動（理論値）

```
T=0ms    setField("resultFlag", "連絡なし辞退")  // setForm queued, setIsDirty queued
T=0ms+   window.confirm 表示（メインスレッドブロック）
T=??ms   ユーザー Cancel クリック
T=??ms+  confirm return false
T=??ms+  onChange 関数 return
T=??ms+  React batch render: form.resultFlag 更新, isDirty=true
T=??ms+  useEffect 発火: setTimeout(doAutoSave, 3000)
T=??+3000ms  timer fire → doAutoSave → API PATCH → DB 更新 ✓
```

→ **Cancel 後 3 秒以上待てば保存される**。

#### Cancel 後 3 秒以内にリロードした場合

```
T=??+1000ms  ユーザーがリロード（F5 や Cmd+R）
beforeunload handler 発火: e.preventDefault() で「Leave site?」ダイアログ
ユーザー「Leave」クリック → unmount → useEffect cleanup → clearTimeout
                                                         ↑ ここで save 死亡
DB 未更新のまま。リロード後 fetchData で resultFlag="" を読み込む。
```

→ **症状B 再現**。

→ ユーザー報告の「リロードすると未選択に戻っている」は、**3 秒待たずにリロードしている**ことが原因と推定。beforeunload プロンプトは**警告は出るが、ユーザーが Leave を押せば素通し**。

#### OK 時の挙動

```
T=??+   confirm return true
T=??+   router.push("/tasks/new?...")  // ← 画面遷移トリガー
T=??+   /tasks/new ページに遷移開始
T=??+   InterviewForm unmount → useEffect cleanup → clearTimeout
        debounce timer 死亡（3 秒未経過）
DB 未更新のまま。
```

→ **症状A 再現**（router.push が即座に unmount を引き起こす）。

---

## 4. 「未選択に戻る」原因候補

### 候補リスト

| # | 候補 | 検証 | 結論 |
|--|--|--|--|
| 4-1 | リロード時 fetchData が DB の空値で上書き | L398-477 fetchData は単純に DB 値を読むだけ | **正しい挙動。DB が空だから空が返る、というシンプルな帰結** |
| 4-2 | doAutoSave が呼ばれていない | useEffect の cleanup でタイマー kill されている | **これが本質。3 秒以内の navigate/reload で save スキップ** |
| 4-3 | Fld 内部 state ずれ | Fld は完全 controlled、内部 state なし | 該当なし |
| 4-4 | API 側の resultFlag 取りこぼし | autosave/route.ts L49-69 で allowedRecordFields に含有 | 該当なし |
| 4-5 | 409 conflict によるサイレント失敗 | toast 出るので CA は気付くはず | 該当しないと推定 |
| 4-6 | 500 エラーによるサイレント失敗 | L590-592 で setSaveStatus("error") のみ、toast なし | **可能性として残る**。本番ログ要確認 |
| 4-7 | autosaveToken の race | 単一セッションなら起きにくい | 低確率 |

### デバッグログ仕込み案（Phase 2 で実施判断）

#### ① doAutoSave 冒頭

```tsx
const doAutoSave = useCallback(async () => {
  console.log("[T-044]", {
    when: "doAutoSave-called",
    formResultFlag: form.resultFlag,
    isDirty,
    interviewId,
    timestamp: new Date().toISOString(),
  });
  // ...
});
```

#### ② onChange の confirm 前後

```tsx
onChange={(v) => {
  console.log("[T-044]", { when: "onChange-start", v });
  setField("resultFlag", v);
  if (v === "連絡なし辞退" || v === "連絡あり辞退") {
    const ok = window.confirm("...");
    console.log("[T-044]", { when: "onChange-after-confirm", ok, formResultFlag: form.resultFlag });
    // ...
  }
}}
```

#### ③ useEffect cleanup での kill 検知

```tsx
return () => {
  if (saveTimerRef.current) {
    console.log("[T-044]", { when: "debounce-killed", reason: "cleanup", timestamp: new Date().toISOString() });
    clearTimeout(saveTimerRef.current);
  }
};
```

これら 3 点を仕込めば、本番で「save が呼ばれた / 呼ばれずに kill された」が確定する。

---

## 5. 室岡ほのかさん等での再現確認方針

| テストケース | 期待結果 |
|--|--|
| Cancel → 5 秒待機 → リロード | resultFlag 保持される（debounce 完走） |
| Cancel → 1 秒以内にリロード（beforeunload を Leave で素通し） | resultFlag 消える（debounce kill） |
| OK → /tasks/new へ遷移 → 戻る | resultFlag 消える（unmount で debounce kill） |
| 他フィールド（フラグ、他AG状況）を変更してリロード | 同じ原理で 3 秒以内なら消える |

→ **resultFlag だけの問題ではなく、「全フィールド」が同じレースに晒されている**。ただし resultFlag は確認ダイアログ + router.push が直後に走るため、**アクション直後にリロードする確率が高く、症状が顕在化しやすい**。

---

## 6. git log 関連変更追跡

| commit | 日付 | 内容 |
|--|--|--|
| `4bf031c` | 2026/5/8 | T-043: interviewDate/startTime を URLSearchParams に追加（params 追記のみ、save ロジック無関係） |
| `9264c84` | 2026/4/28 | **T-028: 辞退分割 + 自動タスク作成（本バグの原因コミット）**。それ以前は `onChange={(v) => setField("resultFlag", v)}` のみで debounce 経由で正常保存 |

→ T-028 で window.confirm + router.push を追加した瞬間に、**3 秒 debounce との race condition が生まれた**。当時の実装者は debounce タイマーが unmount で kill される挙動に気付かなかった。

---

## 7. ローカル再現可否

ローカル `npm run dev` 起動可能（このリポジトリで通常運用）。再現手順:

1. ローカル DB に接続した状態で `npm run dev`
2. `/candidates/[testId]?view=interview` で面談履歴を開く
3. DevTools で AUTOSAVE_DEBOUNCE を 10 秒に一時改造（または現状の 3 秒で時計を見ながら）
4. 「結果」プルダウンで「連絡なし辞退」選択 → Cancel → 即リロード（beforeunload を Leave で押す）
5. リロード後、resultFlag が空であることを確認
6. 同じ操作で 10 秒以上待ってリロード → resultFlag 保持を確認

ローカル DB クエリ: `npx prisma studio` で `interview_records.result_flag` を直接確認。

---

## 総合所見

### 根本原因の判定

**症状A（OK 後 router.push）**: `router.push` で InterviewForm が unmount → useEffect cleanup で `clearTimeout` → 3 秒 debounce 未完走で save スキップ。

**症状B（Cancel 後リロード）**: ユーザーが Cancel 後 3 秒以内にリロード → beforeunload プロンプト出るが Leave で素通し → unmount で同じく `clearTimeout` → save スキップ。

**両症状は同一原因**: 3 秒 debounce が「navigate/reload より遅い」ため、ユーザーアクションに保存処理が間に合わない。

### Phase 2 修正方針の推奨

#### 採用案: **α 案（同期 PATCH を await してから confirm/router.push）**

doAutoSave を override 引数対応に拡張し、resultFlag 変更時のみ debounce をキャンセルして即時保存:

```tsx
// doAutoSave に override パラメータ追加
const doAutoSave = useCallback(async (overrides: Partial<typeof form> = {}) => {
  // ...
  body: JSON.stringify({
    // ...
    resultFlag: (overrides.resultFlag ?? form.resultFlag) || undefined,
    // ...
  }),
}, [...]);

// onChange を async 化
onChange={async (v) => {
  setField("resultFlag", v);
  if (v === "連絡なし辞退" || v === "連絡あり辞退") {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await doAutoSave({ resultFlag: v });  // ← 即時保存（v を override で渡し、stale closure 回避）

    const ok = window.confirm("「面談不参加共有」のタスクを作成しますか？");
    if (ok) {
      router.push(/* ... */);
    }
  }
}}
```

#### 理由

1. **両症状を同時に解決**: confirm の前に保存完了を保証。OK でも Cancel でも DB 更新済み
2. **stale closure 回避**: `v` を override で直接渡すため、`form.resultFlag` の React state flush タイミングに依存しない（state 更新は queued でも override で API body に正しい値が入る）
3. **既存の debounce ロジックを壊さない**: 通常のフィールド変更は従来通り 3 秒 debounce。**resultFlag の確認ダイアログ経路だけ**特別扱い
4. **isDirty も自然解消**: doAutoSave 内の `setIsDirty(false)` で beforeunload 警告も外れる

#### 不採用案

- **β（debounce を 0 ms に）**: 全フィールド即時保存になり、入力中に毎キー保存が走る → API 過負荷 + UX 悪化
- **γ（flushSync 利用）**: React 18+ で event handler 内 flushSync は warning 出る、await 必要、awkward
- **δ（sendBeacon で unmount 時 flush）**: PATCH は sendBeacon に向かない（GET/POST 限定）、複雑化に見合わない

### 想定外の発見

1. **resultFlag を「-」（未選択）に戻すことは autosave 経由では不可能**
   - L570: `resultFlag: form.resultFlag || undefined` → `""` は undefined → API 側 allowedRecordFields の判定で「変更なし」扱い → DB 更新されない
   - 業務的に「いったん辞退と記録 → やっぱり違うので未選択に戻したい」が物理的に出来ない
   - Phase 2 とは別タスクとして検討推奨（T-046 候補: 「resultFlag を null に戻せる autosave 拡張」）

2. **症状B は他フィールドにも潜在**
   - 「フラグ」「他AG状況」など、他のフィールドでも 3 秒以内のリロードで消える
   - 普段気付かれていないだけで、構造的に同じ問題を抱えている
   - α 案で resultFlag だけ即時保存にしても他フィールドには未解決として残る（実害が表面化していないため対応保留可）

3. **500 エラーがサイレント**（L590-592）
   - autosave 失敗時に toast が出ない
   - 本番で API 落ちている時、CA は「保存されていることになっている」状態で気付けない
   - Phase 2 とは別タスク推奨（T-047 候補: 「autosave 失敗の可視化」）

### 緊急対処の選択肢

恒久修正前の暫定策:
- **AUTOSAVE_DEBOUNCE を 3000 → 800 ms 程度に短縮**: 1 行変更のみで本番デプロイ可能。OK 時の router.push までに save 完走する確率が大幅向上。Cancel 後の即リロード対策にもなる
- ただし Cancel 後 800 ms 以内のリロードでは依然として失敗するため、**完全解決ではない**
- 推奨は **α 案を Phase 2 で即実装**。debounce 短縮は「本日中の応急対処」として併用可

---

## ファイル参照一覧

- `src/components/candidates/InterviewForm.tsx` L116（AUTOSAVE_DEBOUNCE 定義）
- `src/components/candidates/InterviewForm.tsx` L250-301（Fld component）
- `src/components/candidates/InterviewForm.tsx` L398-477（fetchData）
- `src/components/candidates/InterviewForm.tsx` L495-499（setField）
- `src/components/candidates/InterviewForm.tsx` L520-611（doAutoSave）
- `src/components/candidates/InterviewForm.tsx` L613-618（debounce useEffect）
- `src/components/candidates/InterviewForm.tsx` L620-627（beforeunload）
- `src/components/candidates/InterviewForm.tsx` L1136-1158（resultFlag onChange）
- `src/app/api/interviews/[id]/autosave/route.ts` L49-69（allowedRecordFields ホワイトリスト）
- commit `9264c84` (T-028, 2026/4/28): 原因コミット
- commit `4bf031c` (T-043, 2026/5/8): 無関係（params 追記のみ）
