"use client";

import { useEffect } from "react";
import EntryBoard from "@/components/entries/EntryBoard";

export default function EntriesPage() {
  useEffect(() => { document.title = "エントリー管理 - Bizstudio"; }, []);
  return (
    <div className="p-6">
      <EntryBoard />
    </div>
  );
}
