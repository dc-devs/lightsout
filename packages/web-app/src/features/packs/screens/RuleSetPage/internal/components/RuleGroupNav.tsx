import type { StandardsPackDocumentView } from '@lightsout/engine';
import { StandardsSet } from '@lightsout/engine/contracts';
import { readDocumentTitle } from '#src/features/packs/internal/common/utils/readDocumentTitle.ts';
import { CodeSpans } from '#src/features/packs/screens/RuleSetPage/internal/components/CodeSpans.tsx';

interface Group {
	id: string;
	document: StandardsPackDocumentView;
	count: number;
}

/** The area a document sits in — its first folder under `code/`, made readable, or unit testing for the tests set. */
const readArea = ({ document }: { document: StandardsPackDocumentView }) => {
	const folder = document.path.split('/')[1] ?? '';

	return document.set === StandardsSet.Tests ? 'Unit testing' : folder.charAt(0).toUpperCase() + folder.slice(1).replaceAll('-', ' ');
};

interface Props {
	groups: Group[];
}

/**
 * The list beside the rules: every document the set holds, under its area,
 * each with how many rules it lists — a way to jump straight to one.
 */
export const RuleGroupNav = ({ groups }: Props) => {
	const areas = [...new Set(groups.map((group) => readArea({ document: group.document })))];

	return (
		<nav aria-label="Rule groups" className="flex flex-col gap-6">
			{areas.map((area) => (
				<div key={area} className="flex flex-col gap-2">
					<p className="font-semibold text-[11px] text-subtle-foreground uppercase tracking-widest">{area}</p>
					<ul className="flex flex-col">
						{groups
							.filter((group) => readArea({ document: group.document }) === area)
							.map((group) => (
								<li key={group.id}>
									<a
										href={`#${group.id}`}
										className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground"
									>
										<span className="truncate">
											<CodeSpans text={readDocumentTitle({ intro: group.document.intro, path: group.document.path })} />
										</span>
										<span className="text-subtle-foreground text-xs tabular-nums">{group.count}</span>
									</a>
								</li>
							))}
					</ul>
				</div>
			))}
		</nav>
	);
};
