import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';
import { SceneStatus } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/SceneStatus.ts';

const statusStyles: Record<SceneStatus, { classes: string; icon: ReactNode }> = {
	[SceneStatus.Working]: { classes: 'border-border bg-muted/50 text-muted-foreground-strong', icon: null },
	[SceneStatus.Over]: {
		classes: 'border-status-failed-border bg-status-failed-light text-status-failed-foreground',
		icon: <CircleAlert aria-hidden="true" className="size-3.5" />,
	},
	[SceneStatus.Fixing]: {
		classes: 'border-primary-tint-border bg-primary-tint text-primary-hover',
		icon: <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />,
	},
	[SceneStatus.Clean]: {
		classes: 'border-status-passed-border bg-status-passed-light text-status-passed-foreground',
		icon: <CircleCheck aria-hidden="true" className="size-3.5" />,
	},
};

interface Props {
	status: SceneStatus;
	children: ReactNode;
}

/** The small pill that says where a scene has got to: counting, over the limit, being fixed, or clean. */
export const StatusChip = ({ status, children }: Props) => (
	<span
		data-status={status}
		className={cn(
			'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold text-xs transition-colors duration-300',
			statusStyles[status].classes,
		)}
	>
		{statusStyles[status].icon}
		{children}
	</span>
);
