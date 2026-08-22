import { cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { BadgeVariant } from '#src/common/constants/BadgeVariant.ts';
import { cn } from '#src/common/utils/cn.ts';

// Unexported for the same reason as Button's: the upstream shadcn file exports
// its variants beside the component, and one file here holds one export.
//
// Square by default, and a pill only for the five run-status families — the
// pill is what a reader already reads as "state of a process", so keeping it
// there and nowhere else is what stops every tag on a page looking like one.
const badgeVariants = cva(
	'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium',
	{
		variants: {
			variant: {
				[BadgeVariant.Neutral]: 'border-border bg-muted text-muted-foreground-strong',
				[BadgeVariant.Running]: 'rounded-full border-status-running-border bg-status-running-light text-status-running',
				[BadgeVariant.Passed]: 'rounded-full border-status-passed-border bg-status-passed-light text-status-passed',
				[BadgeVariant.Failed]: 'rounded-full border-status-failed-border bg-status-failed-light text-status-failed',
				[BadgeVariant.Paused]: 'rounded-full border-status-paused-border bg-status-paused-light text-status-paused',
				[BadgeVariant.Escalated]: 'rounded-full border-status-escalated-border bg-status-escalated-light text-status-escalated',
				[BadgeVariant.Blocking]: 'border-status-failed-border bg-status-failed-light text-severity-blocking',
				[BadgeVariant.Advisory]: 'border-status-running-border bg-status-running-light text-severity-advisory',
				[BadgeVariant.Brand]: 'border-transparent bg-[image:var(--brand-gradient)] text-background',
			},
		},
		defaultVariants: { variant: BadgeVariant.Neutral },
	},
);

interface Props extends ComponentProps<'span'> {
	variant?: BadgeVariant;
}

export const Badge = ({ className, variant, ...rest }: Props) => <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...rest} />;
