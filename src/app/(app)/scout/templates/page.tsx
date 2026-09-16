import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import TemplatesClient from "./_components/TemplatesClient";

// T-207: 配信テンプレート管理（/scout/templates）
// 集計ファイル「テンプレートマスタ」A11:C29 の19本をポータルで持つための画面。
export default async function ScoutTemplatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <TemplatesClient />;
}
