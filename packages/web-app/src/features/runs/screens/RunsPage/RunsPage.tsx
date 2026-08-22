import { ScrollText } from 'lucide-react';
import { Suspense } from 'react';
import { PageHeader, Skeleton } from '#src/appUI/index.ts';
import { RunList } from '#src/features/runs/components/RunList.tsx';

/**
 * Every run on disk, under a heading of its own.
 *
 * The list suspends on its query, so the skeleton rows stand in at the shape
 * the rows themselves will take — a page that reflows once the runs arrive
 * reads as broken, and three rows is enough to say "a list is coming here".
 */
export const RunsPage = () => (
	<div className="flex flex-col gap-4 p-6">
		<PageHeader icon={ScrollText} title="Runs" />
		<Suspense
			fallback={
				<div className="flex flex-col gap-2">
					<Skeleton className="h-12" />
					<Skeleton className="h-12" />
					<Skeleton className="h-12" />
				</div>
			}
		>
			<RunList />
		</Suspense>
	</div>
);
