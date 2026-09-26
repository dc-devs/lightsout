import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { checkKindIcons } from '#src/common/constants/checkKindIcons.ts';
import { checkKindLabels } from '#src/common/constants/checkKindLabels.ts';
import { cn } from '#src/common/utils/cn.ts';

/**
 * The two kinds of check, each named and defined once — the one place the pages
 * say what the labels mean, so every card, filter and tag after it can use the
 * label alone.
 */
export const CheckKindKey = () => (
	<dl className="flex flex-col gap-3 sm:flex-row sm:gap-8">
		{Object.values(CheckKind).map((kind) => {
			const Icon = checkKindIcons[kind];

			return (
				<div key={kind} className="flex items-start gap-3">
					<span
						className={cn(
							'flex size-7 shrink-0 items-center justify-center rounded-lg',
							kind === CheckKind.Deterministic ? 'bg-primary-tint text-primary' : 'bg-agent-light text-agent-foreground',
						)}
					>
						<Icon aria-hidden="true" className="size-3.5" />
					</span>
					<div className="flex flex-col">
						<dt className="font-semibold text-drop-navy text-sm">{checkKindLabels[kind].label}</dt>
						<dd className="text-muted-foreground text-sm">{checkKindLabels[kind].definition}</dd>
					</div>
				</div>
			);
		})}
	</dl>
);
