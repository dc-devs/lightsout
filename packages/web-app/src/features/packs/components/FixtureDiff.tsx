import { FixtureSide, type StandardsPackFixture } from '@lightsout/engine/contracts';
import { MetadataTag, Tabs } from '#src/appUI/index.ts';

/** One fixture file, verbatim. The comments inside a fixture are half of what it teaches, so nothing is stripped. */
const FixtureCode = ({ text }: { text: string }) => (
	<pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-[0.7rem] text-muted-foreground-strong leading-5">{text}</pre>
);

/** The tabs a side with more than one file gets: the path is what tells two examples of the same rule apart. */
const toFixtureTabs = ({ files }: { files: StandardsPackFixture[] }) =>
	files.map((file) => ({ value: file.path, label: <span className="font-mono text-xs">{file.path}</span>, content: <FixtureCode text={file.text} /> }));

/**
 * One side of the proof.
 *
 * A side is a source tree rather than a single file, so more than one file gets
 * a tab strip keyed by path; one file names itself beside the heading instead.
 * An empty side keeps its column and says what is missing — a rule that argues
 * only one way is a fact about the rule, not a gap in the page.
 */
const FixturePane = ({ side, files }: { side: FixtureSide; files: StandardsPackFixture[] }) => (
	<div className="flex min-w-0 flex-col gap-2">
		<div className="flex min-w-0 items-center gap-2">
			<span className={side === FixtureSide.Pass ? 'font-medium text-status-passed text-xs' : 'font-medium text-status-failed text-xs'}>{side}</span>
			{files.length === 1 ? <MetadataTag title={files[0].path}>{files[0].path}</MetadataTag> : null}
		</div>
		{files.length === 0 ? <p className="rounded-md border border-border border-dashed p-3 text-muted-foreground text-xs">no {side} example</p> : null}
		{files.length === 1 ? <FixtureCode text={files[0].text} /> : null}
		{files.length > 1 ? <Tabs items={toFixtureTabs({ files })} /> : null}
	</div>
);

interface Props {
	fixtures: StandardsPackFixture[];
}

/**
 * A rule's proof: the code it catches beside the code it wants.
 *
 * Fail sits left and pass right on a wide screen and the two stack below the
 * `md` breakpoint, decided by the classes alone — no caller chooses a layout,
 * so the same component reads correctly in the showcase strip, an expanded rule
 * row and the rule page.
 */
export const FixtureDiff = ({ fixtures }: Props) =>
	fixtures.length === 0 ? (
		<p className="text-muted-foreground text-sm">This pack shipped without its fixtures.</p>
	) : (
		<div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
			<FixturePane side={FixtureSide.Fail} files={fixtures.filter((fixture) => fixture.side === FixtureSide.Fail)} />
			<FixturePane side={FixtureSide.Pass} files={fixtures.filter((fixture) => fixture.side === FixtureSide.Pass)} />
		</div>
	);
