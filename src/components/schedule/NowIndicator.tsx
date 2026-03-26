"use client";

import { useState, useEffect } from "react";

function getCurrentTimeJST(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  });
}

export default function NowIndicator() {
  const [time, setTime] = useState(getCurrentTimeJST);

  useEffect(() => {
    const interval = setInterval(() => setTime(getCurrentTimeJST()), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
      <span className="text-[11px] font-bold text-red-500 shrink-0">{time}</span>
      <div className="flex-1 h-[2px] bg-red-500" />
    </div>
  );
}

export { getCurrentTimeJST };
