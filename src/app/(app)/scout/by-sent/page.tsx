import { redirect } from "next/navigation";

// T-135 T-C: 集計統合ページへ移設。旧URLは互換のためリダイレクト。
export default function ByDeliveryDateRedirect() {
  redirect("/scout/analytics?view=sent");
}
