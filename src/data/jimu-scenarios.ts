export interface ScenarioOption {
  id: string;
  label: string;
  result: "correct" | "partial" | "incorrect";
}

export interface Scenario {
  questionNumber: number;
  scene: string;
  scenario: string;
  options: ScenarioOption[];
  correctExplanation: string;
  incorrectExplanation: string;
}

export const UNIFIED_SCENARIOS: Scenario[] = [
  {
    questionNumber: 1,
    scene: "取締役会議の資料更新（正確さ）",
    scenario:
      "月末、上司から「来週の取締役会議に使う資料データ、最新版に更新しておいて」と言われました。確認すると前回版との差分が多く、更新箇所が20か所以上あります。あなたはどうしますか？",
    options: [
      { id: "uq1_a", label: "急いで全部更新して提出する", result: "incorrect" },
      {
        id: "uq1_b",
        label: "量が多いので締め切りを延ばしてもらう",
        result: "incorrect",
      },
      {
        id: "uq1_c",
        label: "更新箇所をリスト化して上司に確認してから着手する",
        result: "correct",
      },
      {
        id: "uq1_d",
        label: '前回版のまま「最新です」と提出する',
        result: "incorrect",
      },
    ],
    correctExplanation:
      '「確認してから着手する」が正解です。事務の仕事は"正確さ"が最優先。経営判断に使われるデータに誤りがあれば、会社全体に影響します。中村さんのストーリーでも、この確認が転記ミス3件の発見につながりました。あなたの正確な仕事が、組織の意思決定を支えています。',
    incorrectExplanation:
      '急いで作業したくなる気持ちはわかります。でも事務で大切なのはスピードより"正確さ"。不明点を確認してから着手することが、会社全体を守る仕事につながります。',
  },
  {
    questionNumber: 2,
    scene: "急ぎの見積書作成（スピード × 正確さ）",
    scenario:
      "担当営業から「今日の17時までに見積書を出したい、急ぎで作って」と連絡が来ました。必要情報を確認すると、単価が2パターンあり、どちらで作るか不明です。どうしますか？",
    options: [
      {
        id: "uq2_a",
        label: "確認が取れるまで作業を止める",
        result: "incorrect",
      },
      {
        id: "uq2_b",
        label: "どちらか判断して作り、送付する",
        result: "incorrect",
      },
      {
        id: "uq2_c",
        label: "17時に間に合わなくてもいいので翌日確認してから作る",
        result: "incorrect",
      },
      {
        id: "uq2_d",
        label: "両パターンで作り、どちらかを選ぶよう営業に確認する",
        result: "correct",
      },
    ],
    correctExplanation:
      '中村さんもやっていた「動きながら確認する」が事務の基本姿勢のひとつです。止まらない。でも勝手に決めない。この両立ができる人が、営業から「あの人に任せたい」と信頼されます。スピードと正確さの両方で組織を支えるのが事務の醍醐味です。',
    incorrectExplanation:
      '確認してから動くのは丁寧ですが、急ぎの場面では「スピード × 正確さ」の両方が求められます。止まるのではなく、動きながら確認する。この感覚を身につけると、周囲から絶対的に頼られる存在になります。',
  },
  {
    questionNumber: 3,
    scene: "他部署への経費精算フォロー（社内調整）",
    scenario:
      "決算期、経理担当から「先月の交通費精算書に未提出者が3名いる、確認してほしい」と依頼が来ました。3名とも他部署の忙しそうな社員です。どう動きますか？",
    options: [
      {
        id: "uq3_a",
        label: '経理に「自分で連絡してください」と返す',
        result: "incorrect",
      },
      { id: "uq3_b", label: "メールで一斉に催促する", result: "partial" },
      {
        id: "uq3_c",
        label: "3名分を代わりに記入して提出する",
        result: "incorrect",
      },
      {
        id: "uq3_d",
        label: "締め切りと理由を明示した上で、個別に丁寧に連絡する",
        result: "correct",
      },
    ],
    correctExplanation:
      '事務は「社内の橋渡し役」でもあります。中村さんがやったように、理由をきちんと伝えて丁寧に対応することで、相手も気持ちよく動けます。各部署が正確に機能するよう、丁寧にコーディネートすることが組織全体の精度を上げることにつながります。',
    incorrectExplanation:
      '一斉メールも催促はできますが、忙しい人ほど一斉メールは後回しにします。「あなたに個別にお願いしています」という丁寧さが、結果的に速い対応につながります。',
  },
  {
    questionNumber: 4,
    scene: "契約書の金額ミス発見（気づきと先回り）",
    scenario:
      "受注した契約書を確認していると、金額の記載が口頭合意と異なることに気づきました。担当営業はすでに客先訪問中です。あなたはどうしますか？",
    options: [
      {
        id: "uq4_a",
        label:
          "緊急連絡して事実確認し、必要なら訂正の手続きを先回りして準備する",
        result: "correct",
      },
      {
        id: "uq4_b",
        label: "そのまま処理を進める",
        result: "incorrect",
      },
      { id: "uq4_c", label: "営業が戻るまで待つ", result: "incorrect" },
      { id: "uq4_d", label: "上司に丸投げする", result: "incorrect" },
    ],
    correctExplanation:
      '中村さんがやったように「気づいて → 確認して → 先回りで動く」が事務の信頼を作ります。この一件を防いだあなたの判断が、会社とお客様双方の信頼を守ることになります。「ミスに気づいて止める力」は事務職の最大の武器です。',
    incorrectExplanation:
      '「営業が戻ってから」と思いたくなりますが、お客様に間違った契約書が届いてからでは遅い。緊急度を判断して自分から動ける力が、事務の価値を大きく左右します。',
  },
  {
    questionNumber: 5,
    scene: "3つの同時依頼の優先判断（マルチタスク）",
    scenario:
      "午後、同時に3つの依頼が来ました。\n① 総務部長「明日の会議室、設備の確認をお願い」（所要15分）\n② 経理「今日17時締め切りの支払い申請データ、チェックして」（所要1時間）\n③ 営業の山田さん「請求書を今日中に作って」（所要30分）\n現在14時。どう動きますか？",
    options: [
      {
        id: "uq5_a",
        label: "3つ同時に少しずつ進める",
        result: "incorrect",
      },
      {
        id: "uq5_b",
        label: "①→②→③（来た順番に処理する）",
        result: "incorrect",
      },
      {
        id: "uq5_c",
        label: "②→③→①（締め切りの厳しさと影響度で判断する）",
        result: "correct",
      },
      {
        id: "uq5_d",
        label: "③→①→②（簡単なものから片付ける）",
        result: "incorrect",
      },
    ],
    correctExplanation:
      '②は17時締め切り＋支払いに直結するため最優先。③は「今日中」で営業に影響するので次。①は明日の会議で15分で終わるので最後でも間に合います。事務は常にこうした優先判断をしています。「何を先にやるべきか」を正しく見極める力は、目立たないけれど組織にとって極めて重要な仕事です。',
    incorrectExplanation:
      '来た順や簡単な順で処理したくなる気持ちはわかります。でも事務は「期限 × 影響度」で優先度を判断するのが基本です。この判断力が「あの人に任せれば安心」という信頼につながります。',
  },
];
