import { useEffect, useState } from "react";
import { partnerApi } from "../../lib/api";
import type { Partner } from "../../lib/types";
import { Input } from "../ui/Input";

interface PartnerAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  onSelect: (partner: Partner) => void;
  className?: string;
}

export function PartnerAutocomplete({ value, onChange, onSelect, className }: PartnerAutocompleteProps) {
  const [results, setResults] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      partnerApi
        .list({ q: query, pageSize: 8 })
        .then((res) => {
          if (!cancelled) setResults(res.items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  const showDropdown = open && value.trim().length >= 2 && (loading || results.length > 0);

  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        label="Názov firmy"
        required
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a dropdown item registers before the blur closes it.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {loading && <div className="px-3 py-2 text-sm text-ink-500">Hľadám...</div>}
          {!loading &&
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-canvas"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(p);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-ink-900">{p.name}</span>
                <span className="ml-2 text-ink-500">{p.dic}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
