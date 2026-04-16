"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

type Result = {
  id: string;
  name: string;
  candidateNumber: string;
  careerAdvisorName: string | null;
};

export default function CandidateQuickSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/candidates/search?q=${encodeURIComponent(q)}&limit=10`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const data: Result[] = await res.json();
        setResults(data);
        setOpen(true);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (id: string) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/candidates/${id}`);
  };

  return (
    <div ref={containerRef} className="relative" style={{ width: 250 }}>
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          placeholder="求職者を検索..."
          className="w-full pl-8 pr-3 py-1.5 text-[13px] border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB]"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-300 border-t-[#2563EB] rounded-full animate-spin" />
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-80 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => handleSelect(r.id)}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-blue-50 transition-colors"
              >
                <span className="font-medium text-[#374151]">{r.name}</span>
                <span className="text-gray-400 ml-1">({r.candidateNumber})</span>
                {r.careerAdvisorName && (
                  <span className="text-gray-400 ml-1">— {r.careerAdvisorName}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.length >= 2 && !loading && results.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg px-3 py-3 text-[13px] text-gray-400 text-center">
          該当する求職者が見つかりません
        </div>
      )}
    </div>
  );
}
