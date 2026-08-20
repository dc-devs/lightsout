import type { FrictionRecord } from '@lightsout/engine';
import { Card } from '#src/common/components/ui/Card.tsx';
import { groupBy } from '#src/features/runDetail/screens/RunDetail/components/common/utils/groupBy.ts';

interface Props {
	records: FrictionRecord[];
}

/**
 * What fought the agents, and what they decided when the plan was silent.
 *
 * Grouped by area with a count per group, which is the same shape the terminal
 * report prints — a reader comparing the two should not have to translate.
 */
export const FrictionPanel = ({ records }: Props) => (
	<Card title="Friction">
		{records.length === 0 ? (
			<p className="text-muted-foreground text-sm">This run reported no friction.</p>
		) : (
			<div className="flex flex-col gap-4">
				{groupBy({ items: records, getKey: (record) => record.area }).map(([area, entries]) => (
					<div key={area} className="flex flex-col gap-2">
						<span className="font-medium text-sm">
							{area} · {entries.length}
						</span>
						<ul className="flex flex-col gap-2">
							{entries.map((entry) => (
								<li key={`${entry.at}-${entry.detail}`} className="rounded-md border border-border px-3 py-2 text-xs">
									<span className="text-muted-foreground">
										{entry.kind ?? 'friction'} · <span className="font-mono">{entry.step}</span>
									</span>
									<p className="mt-1 leading-5">{entry.detail}</p>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		)}
	</Card>
);
