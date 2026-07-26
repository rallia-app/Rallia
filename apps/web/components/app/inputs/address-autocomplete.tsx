'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { usePlacesAutocomplete, type PlaceDetails } from '@rallia/shared-hooks';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Google Places address search, in the shape web expects: a combobox whose suggestions
 * appear inline under the field and can be driven from the keyboard.
 *
 * Runs on the shared usePlacesAutocomplete hook, which proxies through
 * /api/places/* on web so the API key stays server-side.
 */
export function AddressAutocomplete({
  value,
  onSelect,
  onClear,
  placeholder,
  label,
  id = 'address-search',
  disabled,
}: {
  /** The chosen address, or empty when nothing is selected yet. */
  value: string;
  onSelect: (details: PlaceDetails) => void;
  onClear: () => void;
  placeholder: string;
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isResolving, setIsResolving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { predictions, isLoading, clearPredictions, getPlaceDetails } = usePlacesAutocomplete({
    searchQuery: query,
    enabled: isOpen && !value,
  });

  // A click anywhere else dismisses the list — without this it survives until the
  // input regains focus, floating over whatever the player moved on to.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const choose = async (placeId: string) => {
    setIsResolving(true);
    try {
      const details = await getPlaceDetails(placeId);
      if (details) {
        onSelect(details);
        setQuery('');
        setIsOpen(false);
        clearPredictions();
      }
    } finally {
      setIsResolving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isOpen || predictions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(i => (i + 1) % predictions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(i => (i <= 0 ? predictions.length - 1 : i - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      // Only swallow Enter when a suggestion is highlighted, so the key still
      // submits the step otherwise.
      event.preventDefault();
      void choose(predictions[activeIndex].placeId);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  // Selected state: a static row with a clear button, not an editable field. Editing
  // a resolved address as free text would leave the coordinates pointing elsewhere.
  if (value) {
    return (
      <div className="space-y-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3">
          <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm text-foreground">{value}</span>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            aria-label={`${label} — clear`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          role="combobox"
          aria-expanded={isOpen && predictions.length > 0}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          disabled={disabled || isResolving}
          onChange={event => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-11 pl-9 pr-9"
        />
        {(isLoading || isResolving) && (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}

        {isOpen && predictions.length > 0 && (
          <ul
            id={`${id}-listbox`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
          >
            {predictions.map((prediction, index) => (
              <li key={prediction.placeId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void choose(prediction.placeId)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                  )}
                >
                  <MapPin
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {prediction.name}
                    </span>
                    {prediction.address && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {prediction.address}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
