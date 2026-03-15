"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Alert = {
  id: string;
  date: string;
  type: string;
  message: string;
  dailyAttendanceId: string;
};

export default function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetch("/api/attendance/alerts")
      .then((r) => r.json())
      .then((data) => setAlerts(data.alerts ?? []))
      .catch(() => {});
  }, []);

  if (alerts.length === 0) return null;

  const shown = alerts.slice(0, 5);
  const remaining = alerts.length - shown.length;

  return (
    <div className="mb-4 rounded-[8px] border-l-4 border-amber-500 bg-amber-50 p-4">
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-amber-600 text-[18px]">&#9888;</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-medium text-amber-800 mb-2">未打刻アラート</p>
          <div className="space-y-1">
            {shown.map((alert) => {
              const dateStr = new Date(alert.date).toISOString().split("T")[0];
              return (
                <Link
                  key={alert.id}
                  href={`/attendance/correction/${dateStr}`}
                  className="block text-[13px] text-amber-700 hover:text-amber-900 hover:underline"
                >
                  {alert.message}
                </Link>
              );
            })}
          </div>
          {remaining > 0 && (
            <p className="mt-1 text-[12px] text-amber-600">他 {remaining} 件</p>
          )}
        </div>
      </div>
    </div>
  );
}
