export default function TopBar({
  companyName,
  userName,
}: {
  companyName: string;
  userName: string;
}) {
  return (
    <header className="h-16 w-full border-b border-[#E5E7EB] bg-white">
      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="text-[18px] font-bold tracking-wide text-[#2563EB]">
            {companyName}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-[14px] font-semibold text-[#374151]">{userName}</div>
          <form action="/api/auth/logout" method="post">
            <button
              className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-[14px] text-[#374151] hover:bg-[#F5F7FA]"
              type="submit"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
