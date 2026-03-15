import { getAccessToken } from "@/lib/lineworks";

const BASE_URL = "https://www.worksapis.com/v1.0";

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "button_template"; contentText: string; actions: ButtonAction[] };

type ButtonAction = { type: "uri"; label: string; uri: string };

/**
 * LINE WORKS Bot からユーザーにメッセージ送信
 */
export async function sendMessageToUser(
  userId: string,
  content: MessageContent
): Promise<void> {
  const botId = process.env.LINEWORKS_BOT_ID;
  if (!botId) {
    console.warn("LINEWORKS_BOT_ID が未設定です");
    return;
  }

  const token = await getAccessToken();

  const res = await fetch(
    `${BASE_URL}/bots/${botId}/users/${userId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`LINE WORKS message failed: ${res.status} ${error}`);
  }
}
