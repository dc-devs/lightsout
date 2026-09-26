import { Check, CircleCheck, CornerDownLeft, LoaderCircle, X } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';
import { demoTicket } from '#src/features/home/common/constants/demoTicket.ts';
import { useLoopingStep } from '#src/features/home/screens/Home/hooks/useLoopingStep.ts';

interface Gate {
	name: string;
	isPassed: boolean;
}

/** One step as the engine records it: what the agent said, and what each gate said back. */
interface Row {
	id: string;
	step: string;
	/** Set on a step the agent is doing again after a gate sent it back. */
	isRetry?: boolean;
	claim: string;
	gates: Gate[];
	/** What happened next, when a gate failed. */
	outcome?: string;
}

/** Every gate passing — the ordinary case, spelled out once. */
const passing = (...names: string[]): Gate[] => names.map((name) => ({ name, isPassed: true }));

/**
 * A staged run, told the way the engine sees it: the agent claims each step is
 * done, and the repo's own lint, type check, tests and build answer. The first
 * claim fails a gate and goes back; the retry is what gets through.
 */
const rows: Row[] = [
	{
		id: 'implement',
		step: 'implement',
		claim: '“Done.”',
		gates: [...passing('lint', 'types'), { name: 'tests', isPassed: false }],
		outcome: 'Sent back · 2 tests failed',
	},
	{ id: 'implement-retry', step: 'implement', isRetry: true, claim: '“Fixed.”', gates: passing('lint', 'types', 'tests') },
	{ id: 'write-tests', step: 'write-tests', claim: '“Done.”', gates: passing('tests', 'coverage') },
	{ id: 'refactor', step: 'refactor', claim: '“Done.”', gates: passing('lint', 'types', 'build') },
];

/**
 * Where each row starts on the log's clock: a row takes one tick to appear, then
 * one tick per gate as each comes back.
 */
const rowStarts = rows.map((_, index) => rows.slice(0, index).reduce((ticks, row) => ticks + 1 + row.gates.length, 0));

/** Every tick the log has, which is also the count once everything is done. */
const tickCount = rows.reduce((ticks, row) => ticks + 1 + row.gates.length, 0);

/**
 * Frame by frame, how many ticks have happened. A failing gate holds for two
 * extra frames — the failure is the moment the card exists to show — and the
 * finished log holds a while before it starts again.
 */
const frames = [
	...rows.flatMap((row, rowIndex) => [
		rowStarts[rowIndex] + 1,
		...row.gates.flatMap((gate, gateIndex) => Array.from({ length: gate.isPassed ? 1 : 3 }, () => rowStarts[rowIndex] + 2 + gateIndex)),
	]),
	...[1, 2, 3, 4, 5].map(() => tickCount),
];

/** The figures under the log. */
const facts = ['1 failure caught', '67 gate runs', '18m 25s', '$6.61'];

/** A gate's verdict: waiting while it runs, then a tick or a cross — the only colour on the card. */
const GateChip = ({ gate, isResolved }: { gate: Gate; isResolved: boolean }) => {
	const state = isResolved ? (gate.isPassed ? 'passed' : 'failed') : 'running';
	const Icon = { running: LoaderCircle, passed: Check, failed: X }[state];

	return (
		<span
			data-state={state}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium text-xs transition-colors duration-300',
				state === 'running' && 'border-border bg-card text-subtle-foreground',
				state === 'passed' && 'border-status-passed-border bg-status-passed-light text-status-passed-foreground',
				state === 'failed' && 'border-status-failed-border bg-status-failed-light text-status-failed-foreground',
			)}
		>
			<Icon aria-hidden="true" className={cn('size-3', state === 'running' && 'animate-spin')} />
			{gate.name}
			<span className="sr-only"> {state}</span>
		</span>
	);
};

/**
 * A run's log as two columns — what the agent said, and what your gates said
 * back — one row per step. A row appears, then its gates come back one at a
 * time; the one that fails sends the step round again.
 *
 * Every row is always laid out, and the ones not reached yet are only faded
 * out, so the card never changes height while it plays. A reader who asked for
 * less motion sees the finished log.
 */
export const GateLog = () => {
	const frame = useLoopingStep({ stepCount: frames.length, stepMs: 450 });
	const ticks = frames[frame];
	const isFinished = ticks === tickCount;

	return (
		<figure
			aria-label="A run’s log: what the agent said, and what the gates said back"
			className="w-full overflow-hidden rounded-2xl border border-border bg-card text-left shadow-blue-900/5 shadow-xl"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-border/60 border-b px-6 py-4">
				<p className="flex min-w-0 items-center gap-3">
					<span className="font-mono text-subtle-foreground text-xs">{demoTicket.key}</span>
					<span className="truncate font-semibold text-drop-navy text-sm">{demoTicket.title}</span>
				</p>
				<span
					className={cn(
						'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-xs transition-colors duration-300',
						isFinished ? 'bg-status-passed-light text-status-passed-foreground' : 'bg-muted text-muted-foreground',
					)}
				>
					{isFinished ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />}
					{isFinished ? 'Passed' : 'Running'}
				</span>
			</div>
			<div
				aria-hidden="true"
				className="hidden grid-cols-[8rem_6rem_1fr] gap-6 border-border/60 border-b bg-muted/60 px-6 py-2.5 font-semibold text-[11px] text-subtle-foreground uppercase tracking-widest sm:grid"
			>
				<span>Step</span>
				<span>Agent said</span>
				<span>Your gates said</span>
			</div>
			<ol>
				{rows.map((row, rowIndex) => {
					const isShown = rowStarts[rowIndex] < ticks;
					const isFailed = row.gates.some((gate, gateIndex) => !gate.isPassed && rowStarts[rowIndex] + 1 + gateIndex < ticks);

					return (
						<li
							key={row.id}
							aria-hidden={!isShown}
							className={cn(
								'grid grid-cols-1 gap-3 border-border/60 px-6 py-4 transition-opacity duration-300 not-first:border-t sm:grid-cols-[8rem_6rem_1fr] sm:items-center sm:gap-6',
								isShown ? 'opacity-100' : 'opacity-0',
							)}
						>
							<span className="flex items-baseline gap-2 font-medium font-mono text-drop-navy text-sm">
								{row.step}
								{row.isRetry ? <span className="font-sans font-normal text-subtle-foreground text-xs">retry</span> : null}
							</span>
							<span className="text-muted-foreground-strong text-sm">{row.claim}</span>
							<div className="flex flex-wrap items-center gap-2">
								{row.gates.map((gate, gateIndex) => (
									<GateChip key={gate.name} gate={gate} isResolved={rowStarts[rowIndex] + 1 + gateIndex < ticks} />
								))}
								{row.outcome === undefined ? null : (
									<span
										className={cn(
											'inline-flex items-center gap-1.5 pl-1 text-muted-foreground text-xs transition-opacity duration-300',
											isFailed ? 'opacity-100' : 'opacity-0',
										)}
									>
										<CornerDownLeft aria-hidden="true" className="size-3" />
										{row.outcome}
									</span>
								)}
							</div>
						</li>
					);
				})}
			</ol>
			<p className="border-border/60 border-t px-6 py-3.5 text-subtle-foreground text-xs">{facts.join(' · ')}</p>
		</figure>
	);
};
