import { Bot, UserRound } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';
import { FlowActor } from '#src/features/home/screens/Home/components/HowItWorksSection/common/constants/FlowActor.ts';

const actorStyles: Record<FlowActor, { label: string; Icon: typeof Bot; classes: string }> = {
	[FlowActor.You]: { label: 'You', Icon: UserRound, classes: 'bg-primary-tint text-primary-hover' },
	[FlowActor.Agent]: { label: 'Agent', Icon: Bot, classes: 'bg-agent-light text-agent-foreground' },
};

interface Props {
	actor: FlowActor;
	className?: string;
}

/** Who does a step, as a face or a bot beside a one-word label — the flow's whole argument, one badge per card. */
export const ActorBadge = ({ actor, className }: Props) => {
	const { label, Icon, classes } = actorStyles[actor];

	return (
		<span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-xs', classes, className)}>
			<Icon aria-hidden="true" className="size-3.5" />
			{label}
		</span>
	);
};
