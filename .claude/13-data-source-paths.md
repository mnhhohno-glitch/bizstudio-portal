# 13. 媒体別データソース経路一覧

## 媒体別経路マトリクス

| 媒体 | 入稿 | kyuujinPDF 処理 | 抽出経路 | db_type |
|--|--|--|--|--|
| HITO-Link | PDF | Google Drive auto-process | Gemini Vision → regex | `hito_mynavi` |
| マイナビJOB | PDF | Google Drive auto-process | Gemini Vision → regex | `hito_mynavi` |
| Bee | PDF | Google Drive auto-process | Gemini Vision → regex | `hito_mynavi` |
| **Circus** | **PDF + メモ帳** | local upload + memo import | Gemini Vision → Circus regex | `circus` |

## Circus の特殊仕様

- PDF を持つ（Gemini Vision にも渡される）
- メモテキスト3行形式（会社名/タイトル/URL）
- URL `search/{id}` ↔ PDF `_No{id}` で紐付け
- PDF レイアウトが独特で Gemini 精度低い
- 真の住所は URL の `__NEXT_DATA__.addressDetail` にある（未活用）

## ファイル名パターン

| 媒体 | パターン | 例 |
|--|--|--|
| HITO-Link | `{会社名}:{求人ID}.pdf` | 株式会社ヤマシタ:141163.pdf |
| Bee | `{会社名}：{求人ID}.pdf` | 進和テック株式会社：141427.pdf |
| マイナビ | `{番号}_{会社名}.pdf` | 28847_株式会社マイナビ.pdf |
| Circus | `{会社名}_No{数字}.pdf` | トラコム株式会社_No28760.pdf |
| DODA | `{会社名}_No{数字}.pdf` | 株式会社フジタ医科器械_No346057.pdf |
