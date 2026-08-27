import type { DedupReport } from '@lightsout/engine/contracts';
import { Card, MetadataTag } from '#src/appUI/index.ts';

interface Props {
	dedup?: DedupReport;
}

/**
 * The prior-art duplications the Dedup Review pass confirmed.
 *
 * Three different facts, and the tab says which one it is: not reviewed,
 * reviewed and clean, or reviewed and these. A clean report and a missing one
 * would otherwise read the same, and only one of them is evidence.
 */
export const DedupTab = ({ dedup }: Props) => {
	if (dedup === undefined) {
		return <p className="text-muted-foreground text-sm">Not reviewed yet — run lightsout plan dedup --name &lt;name&gt;.</p>;
	}

	if (dedup.findings.length === 0) {
		return <p className="text-muted-foreground text-sm">No duplication found.</p>;
	}

	return (
		<div className="flex flex-col gap-3">
			{dedup.findings.map((finding) => (
				<Card key={`${finding.phase}:${finding.plannedSymbol}`} title={finding.plannedSymbol}>
					<div className="flex flex-col gap-2 text-sm">
						<p className="text-muted-foreground">
							Planned in <MetadataTag>{finding.phase}</MetadataTag> at <MetadataTag>{finding.plannedPath}</MetadataTag>
						</p>
						<p>{finding.rationale}</p>
						<p className="text-muted-foreground">
							Collides with:{' '}
							{finding.collidesWith.map((collision) => (
								<MetadataTag key={`${collision.name}:${collision.path}`} className="mr-1">
									{collision.name} · {collision.path}
								</MetadataTag>
							))}
						</p>
						<p>
							<span className="text-muted-foreground">Recommendation: </span>
							{finding.recommendation}
						</p>
					</div>
				</Card>
			))}
		</div>
	);
};
