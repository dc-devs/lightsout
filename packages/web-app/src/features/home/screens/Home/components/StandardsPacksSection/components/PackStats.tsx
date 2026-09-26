import type { StandardsPackListing } from '@lightsout/engine';
import { CheckKind } from '#src/common/constants/CheckKind.ts';
import { checkKindIcons } from '#src/common/constants/checkKindIcons.ts';
import { checkKindLabels } from '#src/common/constants/checkKindLabels.ts';

interface Props {
	/** The default pack lightsout ships; left out until it answers. */
	pack?: StandardsPackListing;
}

/**
 * The pack's rules split by kind of check: the deterministic ones code decides,
 * and the agent checks an agent reviews the change against — the half no linter covers.
 * Counts are the pack's own, read live; without them the two kinds are still
 * named, just not counted.
 */
export const PackStats = ({ pack }: Props) => {
	const kinds = [
		{ Icon: checkKindIcons[CheckKind.Deterministic], count: pack?.totals.checked, label: checkKindLabels[CheckKind.Deterministic].plural },
		{ Icon: checkKindIcons[CheckKind.Agent], count: pack?.totals.judgment, label: checkKindLabels[CheckKind.Agent].plural },
	];

	return (
		<div className="flex flex-col gap-5">
			{pack === undefined ? null : (
				<p className="font-extrabold text-4xl text-drop-navy tracking-tight">
					{pack.totals.rules} <span className="font-semibold text-base text-muted-foreground tracking-normal">rules in the default TypeScript pack</span>
				</p>
			)}
			<ul className="flex flex-col gap-3">
				{kinds.map(({ Icon, count, label }) => (
					<li key={label} className="flex items-center gap-3 text-muted-foreground-strong text-sm">
						<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
							<Icon aria-hidden="true" className="size-4" />
						</span>
						<span>
							{count === undefined ? null : <span className="font-bold text-drop-navy">{count} </span>}
							{count === undefined ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
};
