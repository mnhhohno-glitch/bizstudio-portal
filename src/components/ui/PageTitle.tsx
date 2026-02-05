export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="text-[20px] font-semibold text-[#374151]">{children}</h1>;
}

export function PageSubtleText({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[14px] text-[#374151]/80">{children}</p>;
}
