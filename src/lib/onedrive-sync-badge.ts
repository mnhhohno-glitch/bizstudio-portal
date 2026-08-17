/**
 * T-159 Phase 2-c: OneDrive コピー状況のバッジ（ブックマーク一覧 / 書類タブで共用）。
 *
 * ★正常時は視覚的に無音であること。SUCCESS とログ行なし（＝そもそも対象外・受付前）には
 *   何も出さない。全件に何か出ると「出ている」が情報にならず、CA が見なくなる。
 *
 * ★配色は既存の RATING_PALETTE と同じトークン（bg-*-100 / text-*-800 / border-*-300）に揃える。
 *   新しい色や独自の hex を作らない。
 */

/** files API が返す OneDrive 同期ログの必要項目だけを写した形（サーバ側の enum に依存させない）。 */
export interface OneDriveSyncBadgeSource {
  status: string;
  skipReason?: string | null;
  siblingFolders?: string[] | null;
}

export interface OneDriveSyncBadge {
  label: string;
  /** Tailwind クラス（bg / text / border）。 */
  cls: string;
  /** hover で出す説明。CA が次に何をすればよいかを書く。 */
  title: string;
}

const YELLOW = "bg-yellow-100 text-yellow-800 border-yellow-300";
const GRAY = "bg-gray-100 text-gray-500 border-gray-300";
const RED = "bg-red-100 text-red-800 border-red-300";

/**
 * 1ファイルぶんのバッジ。出すものが無ければ null。
 *
 * SUCCESS 以外を出すが、「まだ試していない」と「CA が手を動かす必要がある」は色で分ける:
 *   灰 = portal 側の都合（待つだけでよい / 設定が無いだけ）
 *   黄 = OneDrive 側に手当てが必要
 *   赤 = 自動では入らないと確定した（誰かが手で入れる）
 */
export function oneDriveSyncBadge(
  sync: OneDriveSyncBadgeSource | null | undefined,
): OneDriveSyncBadge | null {
  // ログ行が無い＝同期対象として受け付けていない（対象外カテゴリ・機能稼働前のファイル）。何も出さない。
  if (!sync) return null;

  if (sync.status === "SUCCESS") return null;

  if (sync.status === "GIVEN_UP") {
    return {
      label: "OneDrive反映失敗",
      cls: RED,
      title:
        "何度試しても OneDrive へコピーできませんでした。自動では入らないため、必要ならこのファイルを手で OneDrive へ入れてください。",
    };
  }

  if (sync.status === "PENDING" || sync.status === "FAILED") {
    return {
      label: "OneDrive反映待ち",
      cls: GRAY,
      title:
        "OneDrive へのコピーがまだ完了していません。夜間の自動処理で改めてコピーされるので、そのままお待ちください。",
    };
  }

  if (sync.status === "SKIPPED") {
    switch (sync.skipReason) {
      case "NO_SUBFOLDER": {
        const siblings = (sync.siblingFolders ?? []).filter((s) => s.length > 0);
        return {
          label: "OneDriveにフォルダなし",
          cls: YELLOW,
          title:
            "コピー先のフォルダ（2.求人 / 3.BS作成書類）が OneDrive にありません。作成すると次の夜間処理でコピーされます。" +
            (siblings.length > 0
              ? `\n代わりにあるフォルダ: ${siblings.join(" / ")}`
              : "\n代わりにあるフォルダ: （なし）"),
        };
      }
      case "NO_FOLDER_URL":
        return {
          label: "OneDrive未設定",
          cls: GRAY,
          title:
            "この求職者に OneDrive フォルダの URL が登録されていません。求職者情報に登録すると次の夜間処理でコピーされます。",
        };
      case "BAD_FOLDER_URL":
        return {
          label: "OneDrive URL不正",
          cls: YELLOW,
          title:
            "登録されている OneDrive フォルダの URL からフォルダを特定できませんでした。URL を貼り直してください。",
        };
      default:
        // NAME_ALREADY_EXISTS（既に OneDrive にある）/ UNSUPPORTED_CATEGORY / GRAPH_ERROR。
        // 前者は入っているので出す必要がなく、後者2つは CA に打つ手が無いので黙る。
        return null;
    }
  }

  return null;
}
