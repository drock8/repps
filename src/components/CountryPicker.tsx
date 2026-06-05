import { useState, useRef, useEffect, useCallback } from "react";
import { COUNTRIES, type Country } from "../data/countries";
import { flagEmoji } from "../lib/flagEmoji";

interface CountryPickerProps {
  value: string | null;
  onChange: (country: Country) => void;
  disabled?: boolean;
}

export default function CountryPicker({ value, onChange, disabled }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? COUNTRIES.find((c) => c.code === value) : null;

  const filtered = search
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.code.toLowerCase().includes(search.toLowerCase())
      )
    : COUNTRIES;

  const handleSelect = useCallback(
    (country: Country) => {
      onChange(country);
      setOpen(false);
      setSearch("");
    },
    [onChange]
  );

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full flex items-center justify-between bg-bg-input text-ink-primary text-body rounded-md px-4 py-3 outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
      >
        {selected ? (
          <span>
            {flagEmoji(selected.code)} {selected.name}
          </span>
        ) : (
          <span className="text-ink-muted">Select country</span>
        )}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-bg-elevated rounded-lg shadow-lg z-50 overflow-hidden border border-divider">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search countries..."
              className="w-full bg-bg-input text-ink-primary text-body rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-accent placeholder:text-ink-muted"
            />
          </div>
          <div ref={listRef} className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-body text-ink-muted">No countries found</p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className={`w-full text-left px-4 py-2.5 text-body transition-colors duration-100 ${
                    value === c.code
                      ? "bg-accent/20 text-accent"
                      : "text-ink-primary active:bg-bg-surface"
                  }`}
                >
                  {flagEmoji(c.code)} {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
