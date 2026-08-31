// T-189: analyze-batch の system ブロック組み立て（プロンプトキャッシュの付与ポリシー）。
//
// 背景（docs/reports/T-189_analyze-batch_cost_cache_batch.md）:
//   従来は「複数バッチ run のみ cache_control を付ける」ガード（isMultiBatch）があり、
//   求人5件以下の run（totalBatches=1）はキャッシュを一切使えていなかった。
//   cache_control が無いリクエストはキャッシュ「参照」もされないため、毎回 21,308トークンの
//   固定部を非キャッシュ入力（$5/1M）で送っており、実測で ¥15.1/件（複数バッチ run の1.8倍）。
//   固定部は候補者をまたいで byte-identical なので、単一バッチ run でも直前の別 run が
//   書いたキャッシュを読める（連続コール間隔は 5分以内72.1% / 1時間以内88.6%）。
//
// 付与ポリシー:
//   ① 固定プレフィックス（skill定義＋評価ルール）… 全実行で cache_control、TTL 1h。
//      run をまたいで共有される唯一のブロックなので、5分TTLでは取りこぼす 1時間以内の
//      再利用（88.6%）まで拾う。
//   ② 候補者context … 全実行で cache_control、TTL は既定（5分）。
//      run 内（バッチ間）でしか再利用されないため 1h（書込2倍）は純損になる。
//   ③ バッチ指示 … 毎バッチ変わるので付けない。
//
// 注意: 1時間TTLのブロックは 5分TTLのブロックより前に置く必要がある（API制約）。
//       ①→②→③ の並びはこの制約を満たしている。

export type EphemeralCacheControl = { type: "ephemeral"; ttl?: "1h" };

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: EphemeralCacheControl;
};

/** ①固定部は 1h TTL。run をまたいで共有されるブロック。 */
export const FIXED_BLOCK_CACHE_CONTROL: EphemeralCacheControl = { type: "ephemeral", ttl: "1h" };

/** ②候補者context は既定TTL（5分）。run 内のバッチ間再利用のみを想定。 */
export const CONTEXT_BLOCK_CACHE_CONTROL: EphemeralCacheControl = { type: "ephemeral" };

export function buildAnalyzeBatchSystemBlocks(params: {
  /** SKILL定義＋評価ルール（候補者・バッチによらず不変） */
  fixedSystem: string;
  /** 候補者情報。空文字/未設定ならブロックごと省略 */
  candidateContext: string | null | undefined;
  /** バッチ指示（毎バッチ変化） */
  batchInstruction: string;
}): SystemBlock[] {
  const blocks: SystemBlock[] = [
    { type: "text", text: params.fixedSystem, cache_control: FIXED_BLOCK_CACHE_CONTROL },
  ];
  if (params.candidateContext && params.candidateContext.trim() !== "") {
    blocks.push({
      type: "text",
      text: `## 候補者情報\n${params.candidateContext}`,
      cache_control: CONTEXT_BLOCK_CACHE_CONTROL,
    });
  }
  blocks.push({ type: "text", text: params.batchInstruction });
  return blocks;
}
