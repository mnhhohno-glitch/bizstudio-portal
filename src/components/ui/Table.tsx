import { ReactNode } from "react";

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="min-w-full border-collapse text-[14px]">{children}</table>;
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-[#E5E7EB] bg-white px-3 py-2 text-left text-[12px] font-semibold text-[#374151]/80">
      {children}
    </th>
  );
}

export function Td({ children }: { children: ReactNode }) {
  return <td className="border-b border-[#E5E7EB] px-3 py-2 text-[#374151]">{children}</td>;
}
