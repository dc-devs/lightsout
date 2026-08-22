import { Badge } from '#src/appUI/badges/Badge.tsx';
import type { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';

interface Props<TStatus extends string> {
	status: TStatus;
	/** What each status says and which colour family it says it in. */
	config: Record<TStatus, { label: string; variant: BadgeVariant }>;
	/** A live process stands behind this right now — renders the pulsing dot. */
	live?: boolean;
}

/**
 * The one place a status becomes a colour and a word.
 *
 * Generic over its config map rather than over one status union, so run status,
 * step status and finding severity all reach the same badge with their own
 * table instead of growing a component each.
 */
export const StatusBadge = <TStatus extends string>({ status, config, live = false }: Props<TStatus>) => (
	<Badge variant={config[status].variant}>
		{live ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
		{config[status].label}
	</Badge>
);
