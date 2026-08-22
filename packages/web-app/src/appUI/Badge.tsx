import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '#src/common/utils/cn.ts';

// Unexported for the same reason as Button's: the upstream shadcn file exports
// its variants beside the component, and one file here holds one export.
const badgeVariants = cva(
	'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
	{
		variants: {
			variant: {
				neutral: 'border-border bg-muted text-muted-foreground-strong',
				running: 'border-status-running-border bg-status-running-light text-status-running',
				passed: 'border-status-passed-border bg-status-passed-light text-status-passed',
				failed: 'border-status-failed-border bg-status-failed-light text-status-failed',
				paused: 'border-status-paused-border bg-status-paused-light text-status-paused',
				escalated: 'border-status-escalated-border bg-status-escalated-light text-status-escalated',
			},
		},
		defaultVariants: { variant: 'neutral' },
	},
);

interface Props extends ComponentProps<'span'> {
	variant?: VariantProps<typeof badgeVariants>['variant'];
}

export const Badge = ({ className, variant, ...rest }: Props) => <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...rest} />;
