// T-183: 面談サポート画面（Phase 1）。面談履歴入力画面の「面談サポート」ボタンから別タブで開く。
import InterviewSupportScreen from "@/components/interview-support/InterviewSupportScreen";

export default async function InterviewSupportPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const { interviewId } = await params;
  return <InterviewSupportScreen interviewId={interviewId} />;
}
