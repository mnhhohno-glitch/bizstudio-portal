// T-206: 閲覧数に数えない User-Agent（リンクのプレビュー取得・クローラー）。
//   LINE のトーク内ブラウザ（"Line/14.x"）は本人の閲覧なので対象外。LINE のプレビュー取得は "line-poker" / "LineSpider"。
const ROBOT_UA = new RegExp(
  [
    "bot", // Googlebot / bingbot / Twitterbot / Discordbot / Slackbot / Telegrambot / Applebot / facebot …
    "crawler",
    "spider", // LineSpider / Baiduspider
    "preview", // BingPreview / SkypeUriPreview / Quora Link Preview …
    "line-poker", // LINE のリンクプレビュー
    "facebookexternalhit",
    "slack-imgproxy",
    "whatsapp",
    "embedly",
    "pinterest",
    "vkshare",
    "google-inspectiontool",
    "googleother",
    "mediapartners-google",
    "headlesschrome",
    "curl/",
    "wget/",
    "python-requests",
    "go-http-client",
    "okhttp",
    "node-fetch",
    "undici",
    "axios",
  ].join("|"),
  "i",
);

/** 空の UA はロボット扱いにしない（判定不能）。呼び出し側で「UA 無しは数えない」を別に扱う。 */
export function isRobotUserAgent(ua: string): boolean {
  return ROBOT_UA.test(ua);
}

/** 閲覧数に数えてよい UA か（空・ロボットは false） */
export function isCountableUserAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return false;
  return !isRobotUserAgent(ua);
}
