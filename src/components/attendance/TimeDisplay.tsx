"use client";

import { useState, useEffect } from "react";

export default function TimeDisplay() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="text-center">
      <p className="text-4xl font-bold text-[#374151] tabular-nums">{timeStr}</p>
      <p className="mt-1 text-[14px] text-[#6B7280]">{dateStr}</p>
    </div>
  );
}
