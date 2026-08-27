import { getSprawlDataset, SprawlComparison } from '#src/features/sprawl/index.ts';

/**
 * Why a repo built this way does not turn into a directory listing.
 *
 * Every number in the copy is read from the dataset's own `caps`, which
 * `scripts/buildSprawlDataset.mjs` took from the standards pack's rule settings
 * — so tuning a cap in the pack changes this paragraph, and nobody has to
 * remember to.
 */
export const SprawlSection = () => {
	const { caps } = getSprawlDataset();

	return (
		<section className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:px-10">
			<h2 className="max-w-3xl font-semibold text-2xl lg:text-3xl">Files and folders have caps. Past the cap, they graduate.</h2>
			<p className="max-w-3xl text-muted-foreground-strong">
				Every level of the repo holds only three kinds of thing: modules, <code className="font-mono text-sm">common/</code>, and files. Growth is one of two
				moves — a file that needs private helpers <strong className="font-medium text-foreground">graduates</strong> into a folder with the same skeleton
				inside; a folder past ~{caps.folderCensus} siblings <strong className="font-medium text-foreground">consolidates</strong> under a parent domain. Same
				shape at every level, so the repo at ten thousand files reads like it did at a hundred.
			</p>
			<p className="max-w-3xl text-muted-foreground-strong">
				The numbers are checked by code, not vibes: functions {caps.function} lines, files {caps.file} ({caps.tsxFile} for{' '}
				<code className="font-mono text-sm">.tsx</code>), test files {caps.testFile}, folders {caps.folderCensus} entries. Over the cap, the refactor pass
				splits it — and <code className="font-mono text-sm">/refactor</code> burns down what is already over.
			</p>
			<SprawlComparison />
		</section>
	);
};
