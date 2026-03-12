"use client";

import { useState } from "react";
import InterviewUrlModal from "@/components/candidates/InterviewUrlModal";

interface GenerateUrlButtonProps {
  candidateName: string;
  advisorName: string | null;
}

export default function GenerateUrlButton({
  candidateName,
  advisorName,
}: GenerateUrlButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[12px] text-[#2563EB] hover:underline"
      >
        URL生成
      </button>
      <InterviewUrlModal
        isOpen={open}
        onClose={() => setOpen(false)}
        candidateName={candidateName}
        advisorName={advisorName}
      />
    </>
  );
}
