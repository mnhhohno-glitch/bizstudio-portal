/* eslint-disable @typescript-eslint/no-explicit-any */
export type InterviewFormData = {
  // Record fields
  candidateId: string;
  interviewDate: string;
  startTime: string;
  endTime: string;
  interviewTool: string;
  interviewerUserId: string;
  interviewType: string;
  resultFlag: string;
  interviewMemo: string;
  rawTranscript: string;
  resumePdfFileId: string;
  summaryText: string;
  // Detail & Rating as nested objects
  detail: Record<string, any>;
  rating: Record<string, any>;
};

export type Employee = { id: string; name: string };
export type CandidateFile = { id: string; fileName: string; driveFileId: string };
export type CandidateInfo = { id: string; name: string; candidateNumber: string };

export const inputCls = "w-full rounded-md border border-gray-300 px-3 py-1.5 text-[13px] focus:border-[#2563EB] focus:outline-none";
export const labelCls = "block text-[12px] font-medium text-[#6B7280] mb-0.5";
