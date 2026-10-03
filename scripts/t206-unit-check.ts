// T-206: 判定関数の単体確認（DB 不要）。npx tsx scripts/t206-unit-check.ts
//   - 選考終了判定 isEntryClosed
//   - 生年月日の正規化・照合（表記ゆれ・JST 暦日）
//   - 公開期限の計算（公開日＋30日の 0:00 JST・表示最終日）
//   - 共通ヘッダー・フッター・検索除けの挿入
//   - 本人確認トークン（別記録・90 日超・改ざん）
//   - ロボット UA 判定
import { isEntryClosed } from "../src/lib/mensetsu/constants";
import { birthdateMatches, candidateBirthdayYmd, normalizeBirthdateInput } from "../src/lib/mensetsu/birthdate";
import { expiresAtFrom, lastViewableDayYmd, jstYmd } from "../src/lib/mensetsu/dates";
import { wrapMensetsuHtml } from "../src/lib/mensetsu/wrapper";
import { issueViewerToken, verifyViewerToken } from "../src/lib/mensetsu/viewer-token";
import { isCountableUserAgent } from "../src/lib/mensetsu/robot";
import { buildGuideMessage } from "../src/lib/mensetsu/guide-message";
import { resolveDisplayStatus } from "../src/lib/mensetsu/state";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  NG ${name}: got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  }
}

// --- isEntryClosed
const base = { entryFlag: "面接", entryFlagDetail: "一次面接実施前", personFlag: null, companyFlag: null, acceptanceDate: null, archivedAt: null };
eq("open: 面接/一次面接実施前", isEntryClosed(base), false);
eq("open: 書類選考/選考中", isEntryClosed({ ...base, entryFlag: "書類選考", entryFlagDetail: "選考中" }), false);
eq("open: 内定/検討中", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "検討中" }), false);
eq("open: 見送り通知未送信（本人へ未通知）", isEntryClosed({ ...base, entryFlagDetail: "選考中", personFlag: "見送り通知未送信" }), false);
eq("open: null entry", isEntryClosed(null), false);
eq("closed: 書類見送り", isEntryClosed({ ...base, entryFlagDetail: "書類見送り" }), true);
eq("closed: 面接見送り", isEntryClosed({ ...base, entryFlagDetail: "面接見送り" }), true);
eq("closed: 選考落ち", isEntryClosed({ ...base, entryFlag: "書類選考", entryFlagDetail: "選考落ち" }), true);
eq("closed: 本人辞退", isEntryClosed({ ...base, entryFlagDetail: "本人辞退" }), true);
eq("closed: 本人辞退_他社決", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "本人辞退_他社決" }), true);
eq("closed: 本人辞退_自社他", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "本人辞退_自社他" }), true);
eq("closed: クローズ", isEntryClosed({ ...base, entryFlag: "エントリー", entryFlagDetail: "クローズ" }), true);
eq("closed: 求人クローズ", isEntryClosed({ ...base, entryFlagDetail: "求人クローズ" }), true);
eq("closed: 内定/承諾", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "承諾" }), true);
eq("closed: 入社済", isEntryClosed({ ...base, entryFlag: "入社済", entryFlagDetail: null }), true);
eq("closed: personFlag 見送り通知送信済", isEntryClosed({ ...base, entryFlagDetail: "選考中", personFlag: "見送り通知送信済" }), true);
eq("closed: personFlag 見送り通知済み", isEntryClosed({ ...base, entryFlagDetail: "選考中", personFlag: "見送り通知済み" }), true);
eq("closed: personFlag 辞退受付済", isEntryClosed({ ...base, entryFlagDetail: "選考中", personFlag: "辞退受付済" }), true);
eq("closed: personFlag 入社済", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "検討中", personFlag: "入社済" }), true);
eq("closed: companyFlag 辞退報告済", isEntryClosed({ ...base, entryFlagDetail: "選考中", companyFlag: "辞退報告済" }), true);
eq("closed: companyFlag 入社報告済", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "検討中", companyFlag: "入社報告済" }), true);
eq("closed: 内定 + acceptanceDate", isEntryClosed({ ...base, entryFlag: "内定", entryFlagDetail: "検討中", acceptanceDate: new Date("2026-09-01") }), true);
eq("closed: archivedAt", isEntryClosed({ ...base, archivedAt: new Date("2026-07-09") }), true);

// --- birthdate
eq("norm 1990/4/15", normalizeBirthdateInput("1990/4/15"), "19900415");
eq("norm 1990-04-15", normalizeBirthdateInput("1990-04-15"), "19900415");
eq("norm 1990.04.15", normalizeBirthdateInput("1990.04.15"), "19900415");
eq("norm 全角", normalizeBirthdateInput("１９９０／０４／１５"), "19900415");
eq("norm 全角8桁", normalizeBirthdateInput("１９９００４１５"), "19900415");
eq("norm 年月日", normalizeBirthdateInput("1990年4月15日"), "19900415");
eq("norm 空白", normalizeBirthdateInput(" 1990 04 15 "), "19900415");
eq("norm 8桁", normalizeBirthdateInput("19900415"), "19900415");
eq("norm 不正 7桁", normalizeBirthdateInput("1990415"), null);
eq("norm 不正 文字", normalizeBirthdateInput("abc"), null);
eq("norm 不正 月13", normalizeBirthdateInput("1990/13/01"), null);
eq("norm 不正 型", normalizeBirthdateInput(19900415), null);
// 保存形式: UTC 00:00（732件）/ UTC 12:00（3861件）どちらも JST 暦日は同じ
eq("ymd UTC00", candidateBirthdayYmd(new Date("1983-05-05T00:00:00.000Z")), "19830505");
eq("ymd UTC12", candidateBirthdayYmd(new Date("1997-08-03T12:00:00.000Z")), "19970803");
eq("ymd null", candidateBirthdayYmd(null), null);
eq("match ok", birthdateMatches("1983/05/05", new Date("1983-05-05T00:00:00.000Z")), true);
eq("match ng", birthdateMatches("1983/05/06", new Date("1983-05-05T00:00:00.000Z")), false);
eq("match no birthday", birthdateMatches("1983/05/05", null), false);

// --- dates
const exp = expiresAtFrom("2026-09-30", 30);
eq("expiresAt 9/30+30 = 10/30 0:00 JST", exp.toISOString(), "2026-10-29T15:00:00.000Z");
eq("lastViewableDay = 10/29", lastViewableDayYmd(exp), "2026-10-29");
eq("jstYmd of 2026-10-03T15:00Z = 10/04", jstYmd(new Date("2026-10-03T15:00:00.000Z")), "2026-10-04");
eq("jstYmd of 2026-10-03T14:59Z = 10/03", jstYmd(new Date("2026-10-03T14:59:59.000Z")), "2026-10-03");

// --- state
const pub = { status: "published", expiresAt: exp, entry: null };
eq("state published", resolveDisplayStatus(pub, new Date("2026-10-29T14:59:00Z")), "published");
eq("state expired", resolveDisplayStatus(pub, new Date("2026-10-29T15:00:00Z")), "expired");
eq("state stopped", resolveDisplayStatus({ ...pub, status: "stopped" }, new Date("2026-10-01T00:00:00Z")), "stopped");
eq("state closed", resolveDisplayStatus({ ...pub, entry: { ...base, entryFlagDetail: "書類見送り" } }, new Date("2026-10-01T00:00:00Z")), "closed");
eq("state draft", resolveDisplayStatus({ ...pub, status: "draft" }), "draft");

// --- wrapper
const full = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>t</title></head><body class="x"><h1>hi</h1></body></html>`;
const wrapped = wrapMensetsuHtml(full, { candidateName: "大野 テスト" });
eq("wrap: robots meta", wrapped.includes(`<meta name="robots" content="noindex, nofollow, noarchive">`), true);
eq("wrap: referrer meta", wrapped.includes(`<meta name="referrer" content="no-referrer">`), true);
eq("wrap: header after body", /<body class="x">\n<div class="bzs-wrap-header"/.test(wrapped), true);
eq("wrap: name in header", wrapped.includes("大野 テスト様 専用ページ"), true);
eq("wrap: footer before /body", /<div class="bzs-wrap-footer"[\s\S]*<\/div>\n<\/body>/.test(wrapped), true);
eq("wrap: escapes name", wrapMensetsuHtml(full, { candidateName: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;様"), true);
const frag = wrapMensetsuHtml(`<h1>frag</h1>`, { candidateName: "A B" });
eq("wrap fragment: doctype", frag.startsWith("<!doctype html>"), true);
eq("wrap fragment: viewport", frag.includes(`name="viewport"`), true);
eq("wrap fragment: body content", frag.includes("<h1>frag</h1>"), true);

// --- token
process.env.MENSETSU_TOKEN_SECRET = "unit-test-secret-0123456789abcdef";
const now = new Date("2026-10-04T00:00:00Z");
const tok = issueViewerToken("pageA", now);
eq("token ok", verifyViewerToken(tok, "pageA", now), true);
eq("token other page", verifyViewerToken(tok, "pageB", now), false);
eq("token tampered", verifyViewerToken(tok.slice(0, -2) + "zz", "pageA", now), false);
eq("token 89 days", verifyViewerToken(tok, "pageA", new Date(now.getTime() + 89 * 86400000)), true);
eq("token 91 days", verifyViewerToken(tok, "pageA", new Date(now.getTime() + 91 * 86400000)), false);
eq("token garbage", verifyViewerToken("abc", "pageA", now), false);
eq("token undefined", verifyViewerToken(undefined, "pageA", now), false);

// --- robot UA
eq("ua chrome", isCountableUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), true);
eq("ua LINE in-app browser", isCountableUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0/IAB"), true);
eq("ua LINE preview (line-poker)", isCountableUserAgent("facebookexternalhit/1.1;line-poker/1.0"), false);
eq("ua LineSpider", isCountableUserAgent("Mozilla/5.0 (compatible; LineSpider/1.0)"), false);
eq("ua Slackbot", isCountableUserAgent("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"), false);
eq("ua Twitterbot", isCountableUserAgent("Twitterbot/1.0"), false);
eq("ua Discordbot", isCountableUserAgent("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"), false);
eq("ua Googlebot", isCountableUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), false);
eq("ua bingbot", isCountableUserAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"), false);
eq("ua facebookexternalhit", isCountableUserAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"), false);
eq("ua empty", isCountableUserAgent(""), false);
eq("ua null", isCountableUserAgent(null), false);

// --- guide message
const g = buildGuideMessage({ candidateName: "岡野 佑美", companyName: "Dr.JOY株式会社", stage: "一次面接", url: "https://mensetsu.bizstudio.co.jp/jb6oFtu", lastViewableDayYmd: "2026-10-29", requireBirthdate: true });
eq("guide line1", g.split("\n")[0], "岡野さん");
eq("guide line2", g.split("\n")[1], "Dr.JOY株式会社の一次面接に向けた対策資料をお送りします。");
eq("guide includes date", g.includes("（10月29日まで公開）"), true);
eq("guide includes birthdate line", g.includes("初回のみ、ご本人確認のため生年月日の入力をお願いします。"), true);
const g2 = buildGuideMessage({ candidateName: "岡野 佑美", companyName: null, stage: "一次面接", url: "u", lastViewableDayYmd: "2026-10-29", requireBirthdate: false, updated: true });
eq("guide updated line2", g2.split("\n")[1], "面接対策の内容を反映して、資料を更新しました。");
eq("guide no birthdate line", g2.includes("初回のみ"), false);
const g3 = buildGuideMessage({ candidateName: "岡野 佑美", companyName: null, stage: "最終面接", url: "u", lastViewableDayYmd: "2026-10-29", requireBirthdate: true });
eq("guide no company", g3.split("\n")[1], "最終面接に向けた対策資料をお送りします。");

console.log(`\nT-206 unit check: pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;

export {};
