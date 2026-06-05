import { useState, useRef, useEffect } from "react";
import { COUNTRIES } from "../../data/countries";
import { flagEmoji } from "../../lib/flagEmoji";

type TimePeriod = "daily" | "weekly" | "monthly" | "yearly" | "all";
type GenderFilter = "all" | "female" | "male" | "non_binary";

interface FilterState {
  period: TimePeriod;
  gender: GenderFilter;
  ageBracket: string;
  country: string;
}

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (filters: FilterState) => void;
  showCountry: boolean;
}

const TIME_OPTIONS: { label: string; value: TimePeriod }[] = [
  { label: "Today", value: "daily" },
  { label: "This Week", value: "weekly" },
  { label: "This Month", value: "monthly" },
  { label: "This Year", value: "yearly" },
  { label: "All Time", value: "all" },
];

const GENDER_OPTIONS: { label: string; value: GenderFilter }[] = [
  { label: "All", value: "all" },
  { label: "Female", value: "female" },
  { label: "Male", value: "male" },
  { label: "Non-binary", value: "non_binary" },
];

const AGE_BRACKETS = [
  "all", "13-19", "20-29", "30-39", "40-49",
  "50-59", "60-69", "70-79", "80-89", "90-99", "100+",
];

const DEFAULTS: FilterState = { period: "daily", gender: "all", ageBracket: "all", country: "" };

export default function FilterSheet({ open, onClose, filters, onApply, showCountry }: FilterSheetProps) {
  const [draft, setDraft] = useState<FilterState>(filters);
  const [countrySearch, setCountrySearch] = useState("");
  const [countryOpen, setCountryOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  if (!open) return null;

  const filteredCountries = countrySearch
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
          c.code.toLowerCase().includes(countrySearch.toLowerCase())
      )
    : COUNTRIES;

  const selectedCountry = draft.country
    ? COUNTRIES.find((c) => c.code === draft.country)
    : null;

  const handleReset = () => setDraft(DEFAULTS);

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={sheetRef}
        className="relative w-full max-w-lg bg-bg-elevated rounded-t-2xl border-t border-divider overflow-hidden"
        style={{ animation: "slideUp 0.3s ease-out", maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-ink-muted" />
        </div>

        <div className="flex items-center justify-between px-5 pb-3">
          <p className="text-body text-ink-primary font-semibold">Filters</p>
          <button onClick={handleReset} className="text-caption text-accent">
            Reset
          </button>
        </div>

        <div className="px-5 pb-6 overflow-y-auto" style={{ maxHeight: "calc(70vh - 140px)" }}>
          {/* Time */}
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Time</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {TIME_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setDraft({ ...draft, period: t.value })}
                className={`px-3 py-1.5 rounded-pill text-micro transition-colors duration-200 ease-apple ${
                  draft.period === t.value
                    ? "bg-accent text-ink-inverse font-bold"
                    : "bg-bg-surface text-ink-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Gender */}
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Gender</p>
          <div className="flex flex-wrap gap-2 mb-5">
            {GENDER_OPTIONS.map((g) => (
              <button
                key={g.value}
                onClick={() => setDraft({ ...draft, gender: g.value })}
                className={`px-3 py-1.5 rounded-pill text-micro transition-colors duration-200 ease-apple ${
                  draft.gender === g.value
                    ? "bg-accent text-ink-inverse font-bold"
                    : "bg-bg-surface text-ink-secondary"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>

          {/* Age bracket */}
          <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Age</p>
          <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
            {AGE_BRACKETS.map((a) => (
              <button
                key={a}
                onClick={() => setDraft({ ...draft, ageBracket: a })}
                className={`px-3 py-1.5 rounded-pill text-micro whitespace-nowrap transition-colors duration-200 ease-apple ${
                  draft.ageBracket === a
                    ? "bg-accent text-ink-inverse font-bold"
                    : "bg-bg-surface text-ink-secondary"
                }`}
              >
                {a === "all" ? "All" : a}
              </button>
            ))}
          </div>

          {/* Country (Individual scope only) */}
          {showCountry && (
            <>
              <p className="text-micro text-ink-muted uppercase tracking-wide mb-2">Country</p>
              <div className="relative mb-5">
                <button
                  onClick={() => setCountryOpen(!countryOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-bg-input rounded-lg border border-divider text-left"
                >
                  <span className="text-caption text-ink-primary">
                    {selectedCountry
                      ? `${flagEmoji(selectedCountry.code)} ${selectedCountry.name}`
                      : "All countries"}
                  </span>
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-ink-muted transition-transform duration-200 ${countryOpen ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {countryOpen && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-bg-elevated rounded-lg border border-divider shadow-lg max-h-48 overflow-hidden flex flex-col">
                    <input
                      type="text"
                      value={countrySearch}
                      onChange={(e) => setCountrySearch(e.target.value)}
                      placeholder="Search countries..."
                      autoFocus
                      className="w-full px-3 py-2 bg-bg-input text-caption text-ink-primary placeholder-ink-muted border-b border-divider outline-none"
                    />
                    <div className="overflow-y-auto flex-1">
                      <button
                        onClick={() => {
                          setDraft({ ...draft, country: "" });
                          setCountryOpen(false);
                          setCountrySearch("");
                        }}
                        className={`w-full text-left px-3 py-2 text-caption ${
                          !draft.country ? "bg-accent/20 text-accent" : "text-ink-primary active:bg-bg-surface"
                        }`}
                      >
                        All countries
                      </button>
                      {filteredCountries.map((c) => (
                        <button
                          key={c.code}
                          onClick={() => {
                            setDraft({ ...draft, country: c.code });
                            setCountryOpen(false);
                            setCountrySearch("");
                          }}
                          className={`w-full text-left px-3 py-2 text-caption ${
                            draft.country === c.code ? "bg-accent/20 text-accent" : "text-ink-primary active:bg-bg-surface"
                          }`}
                        >
                          {flagEmoji(c.code)} {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 pb-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
          <button
            onClick={handleApply}
            className="w-full py-3 bg-accent text-ink-inverse font-bold rounded-pill text-body transition-colors duration-200 ease-apple active:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export type { FilterState };
