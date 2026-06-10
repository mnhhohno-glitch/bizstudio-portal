// T-096: 社員詳細の機微情報（貸与物パスワード類）用の汎用暗号化ラッパ。
//
// 実体は src/lib/encryption.ts の encrypt/decrypt（AES-256-GCM、
// 鍵は MANUS_KEY_ENCRYPTION_SECRET の sha256）をそのまま使う。
// Manus APIキー暗号化と同じ方式・同じ鍵だが、用途を明示するために別名で切り出す。
// 既存の encrypt/decrypt・Manus 処理の挙動は一切変更しない。
import { encrypt, decrypt } from "@/lib/encryption";

/** 平文の機微情報を暗号化して DB 保存用文字列（base64）にする。 */
export function encryptSecret(plain: string): string {
  return encrypt(plain);
}

/** DB 保存済みの暗号文（base64）を復号して平文を返す。 */
export function decryptSecret(encrypted: string): string {
  return decrypt(encrypted);
}
