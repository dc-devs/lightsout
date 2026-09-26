import type { ReactNode } from 'react';
import { cn } from '#src/common/utils/cn.ts';
import type { FlowActor } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/common/constants/FlowActor.ts';
import { ActorBadge } from '#src/features/home/screens/Home/internal/components/HowItWorksSection/internal/components/ActorBadge.tsx';

interface Props {
	/** The command a reader types, or the one the engine runs. */
	command: string;
	actor: FlowActor;
	/** What the step does, in one line. */
	body: string;
	/** A step a run can leave out: drawn with a dashed edge and tagged, so it reads as optional before a word is read. */
	isOptional?: boolean;
	/** Anything the step carries below its line: an alternative command, or the stages it runs. */
	children?: ReactNode;
}

/** One step of the flow: who does it, the command, and what it does. */
export const FlowStepCard = ({ command, actor, body, isOptional = false, children }: Props) => (
	<article
		className={cn(
			'flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border bg-card p-5',
			isOptional ? 'border-2 border-border border-dashed' : 'border-border shadow-sm',
		)}
	>
		<div className="flex flex-wrap items-center justify-between gap-2">
			<ActorBadge actor={actor} />
			{isOptional ? (
				<span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
					Optional
				</span>
			) : null}
		</div>
		<h3 className="font-bold font-mono text-base text-drop-navy">{command}</h3>
		<p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
		{children}
	</article>
);
