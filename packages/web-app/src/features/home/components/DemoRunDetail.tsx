import { useEffect, useState } from 'react';
import { Skeleton } from '#src/appUI/index.ts';
import { RunDetailBody, toRunDetailView } from '#src/features/runDetail/index.ts';
import type { DemoRunSlug } from '#src/lightsout/common/constants/DemoRunSlug.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';

interface Props {
	slug: DemoRunSlug;
}

/**
 * One frozen run, rendered by the components the local viewer uses.
 *
 * This is the whole point of the proof section: the page shows the product
 * rather than a picture of it, so the marketing page cannot drift from what a
 * reader will actually see. It does not reuse `RunDetail`, which reads its view
 * from a suspending query — this one has its view in hand.
 *
 * A frozen run from another repository can be resumed from nobody's machine, so
 * the shell commands are suppressed beside the links.
 *
 * The mount flag is what keeps the server render and the first client render
 * identical. `React.lazy` in the section above still renders on the server, and
 * a frozen run's ids belong to no live router — so both passes emit the skeleton
 * and the real body appears only once the browser has it.
 */
export const DemoRunDetail = ({ slug }: Props) => {
	const [isMounted, setIsMounted] = useState(false);

	useEffect(() => setIsMounted(true), []);

	return isMounted ? (
		<div className="max-h-[32rem] overflow-hidden">
			<RunDetailBody view={toRunDetailView({ view: getDemoRunViews()[slug] })} onOpenPlan={() => {}} linksDisabled commandsDisabled />
		</div>
	) : (
		<Skeleton className="h-[32rem] w-full rounded-none" />
	);
};
