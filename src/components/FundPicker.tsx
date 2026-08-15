import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { MutualFund } from '@/types/mutualFund';
import { schemeLabel } from '@/utils/schemeName';
import { formatPercent } from '@/utils/format';

interface FundPickerProps {
  /** Full universe to search, unfiltered by the builder's rules. */
  funds: MutualFund[];
  /** Ids already pinned, shown as selected. */
  selectedIds: string[];
  onToggle: (fund: MutualFund) => void;
  /** Cap on how many results to render, since the universe is ~1,500 funds. */
  limit?: number;
}

/**
 * Searchable fund picker.
 *
 * Deliberately searches the **whole universe**, not the builder's filtered
 * candidates. The entire point is adding a fund you researched or already hold,
 * and such a fund may well fail your own screening rules — which is exactly when
 * you need to be able to find it. buildPortfolio warns when a pin fails the
 * filters rather than hiding it here.
 */
export function FundPicker({ funds, selectedIds, onToggle, limit = 50 }: FundPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // cmdk filters internally, but over ~1,500 items that is slow and it scores
    // on the rendered string. Pre-filtering on the fields people actually search
    // keeps it responsive and predictable.
    const matches = needle
      ? funds.filter((fund) => {
          const haystack = `${fund.schemeName} ${fund.fundHouse} ${fund.subCategory}`.toLowerCase();
          return haystack.includes(needle);
        })
      : funds;

    return matches.slice(0, limit);
  }, [funds, query, limit]);

  const hidden = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const total = needle
      ? funds.filter((fund) =>
          `${fund.schemeName} ${fund.fundHouse} ${fund.subCategory}`
            .toLowerCase()
            .includes(needle),
        ).length
      : funds.length;
    return Math.max(0, total - results.length);
  }, [funds, query, results.length]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add a specific fund
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[min(32rem,90vw)] p-0" align="start">
        {/* shouldFilter=false because the filtering happens above. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by scheme, fund house, or category..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No fund matches that search.</CommandEmpty>
            <CommandGroup>
              {results.map((fund) => {
                const label = schemeLabel(fund);
                const isSelected = selected.has(fund.id);

                return (
                  <CommandItem
                    key={fund.id}
                    value={fund.id}
                    onSelect={() => onToggle(fund)}
                    className="flex items-start gap-2"
                  >
                    <Check
                      className={`h-4 w-4 mt-0.5 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{label.scheme}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {label.house}
                        {fund.subCategory ? ` · ${fund.subCategory}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      <div>{formatPercent(fund.returns?.threeYear)} 3Y</div>
                      <div>{formatPercent(fund.expenseRatio)} TER</div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {hidden > 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                {hidden} more match — keep typing to narrow it down.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface PinnedFundListProps {
  funds: MutualFund[];
  onRemove: (fund: MutualFund) => void;
}

/** Chips for the pinned funds, with a way to unpin each. */
export function PinnedFundList({ funds, onRemove }: PinnedFundListProps) {
  if (funds.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {funds.map((fund) => {
        const label = schemeLabel(fund);
        return (
          <Badge
            key={fund.id}
            variant="secondary"
            className="gap-1.5 max-w-full"
            title={label.full}
          >
            <span className="truncate">{label.scheme}</span>
            <button
              type="button"
              aria-label={`Remove ${label.full}`}
              onClick={() => onRemove(fund)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
