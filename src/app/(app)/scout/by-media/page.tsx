import { redirect } from "next/navigation";

// T-135 T-C: 集計統合ページへ移設。旧URLは互換のためリダイレクト。
export default function ByMediaRedirect() {
  redirect("/scout/analytics?view=media");
}
