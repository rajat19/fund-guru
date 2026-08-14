import { Info, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DIRECTION_LABEL, metricInfoFor, type MetricDirection } from '@/utils/metricInfo';

const DIRECTION_STYLE: Record<MetricDirection, { icon: typeof ArrowUp; className: string }> = {
  higher: { icon: ArrowUp, className: 'text-emerald-600 dark:text-emerald-400' },
  lower: { icon: ArrowDown, className: 'text-emerald-600 dark:text-emerald-400' },
  depends: { icon: Minus, className: 'text-muted-foreground' },
};

interface MetricInfoTipProps {
  metricKey: string;
}

/**
 * Info affordance next to a metric name: what it means, and which direction is
 * actually better.
 *
 * Requires a TooltipProvider above it in the tree.
 */
export function MetricInfoTip({ metricKey }: MetricInfoTipProps) {
  const info = metricInfoFor(metricKey);
  if (!info) return null;

  const { icon: DirectionIcon, className } = DIRECTION_STYLE[info.direction];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Tooltips do not open on touch, so the label is also the accessible
          // name — screen readers and long-press both get the direction at least.
          aria-label={`${info.label}: ${DIRECTION_LABEL[info.direction]}`}
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors align-middle"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs space-y-1.5">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${className}`}>
          <DirectionIcon className="h-3 w-3 shrink-0" />
          {DIRECTION_LABEL[info.direction]}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{info.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Compact arrow shown inline in a header, for scanning without hovering. */
export function DirectionHint({ metricKey }: MetricInfoTipProps) {
  const info = metricInfoFor(metricKey);
  if (!info || info.direction === 'depends') return null;

  const Icon = info.direction === 'higher' ? ArrowUp : ArrowDown;
  return <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />;
}
