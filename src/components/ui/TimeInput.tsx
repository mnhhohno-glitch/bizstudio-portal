"use client";

import { useState, useEffect } from "react";

interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
}

function normalizeTime(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const colonMatch = trimmed.match(/^(\d{1,2}):(\d{0,2})$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1], 10);
    const m = colonMatch[2] ? parseInt(colonMatch[2], 10) : 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return "";

  let h: number, m: number;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else if (digits.length === 3) {
    h = parseInt(digits[0], 10);
    m = parseInt(digits.slice(1), 10);
  } else if (digits.length === 4) {
    h = parseInt(digits.slice(0, 2), 10);
    m = parseInt(digits.slice(2), 10);
  } else {
    return null;
  }

  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimeInput({
  value,
  onChange,
  className,
  style,
  placeholder = "HH:MM",
  disabled,
  required,
  readOnly,
}: TimeInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleBlur = () => {
    const normalized = normalizeTime(localValue);
    if (normalized === null) {
      setError(true);
      setLocalValue(value);
      return;
    }
    setError(false);
    setLocalValue(normalized);
    onChange(normalized);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
    setError(false);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      readOnly={readOnly}
      className={className}
      style={error ? { ...style, borderColor: "#ef4444" } : style}
      maxLength={5}
    />
  );
}
