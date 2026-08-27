import type { GateEvidence, RunView } from '@lightsout/engine';
import { formatDuration } from '@lightsout/shared';
import { useState } from 'react';
import { Button, Card } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';

/** A command that ran and came back non-zero — the only rows worth reading first. */
const hasFailed = ({ gate }: { gate: GateEvidence }) => gate.exitCode !== undefined && gate.exitCode !== 0;

/** One `commands.jsonl` line. A failing row opens to its captured output; a passing one has none to show. */
const GateRow = ({ gate, showStep = false }: { gate: GateEvidence; showStep?: boolean }) => (
	<details className="rounded-md border border-border px-3 py-2 text-xs open:bg-muted">
		<summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
			<span className={hasFailed({ gate }) ? 'font-medium text-status-failed' : 'text-muted-foreground'}>{gate.kind}</span>
			<span className="text-muted-foreground">{gate.group}</span>
			{showStep ? <span className="font-mono text-muted-foreground">{gate.step ?? '—'}</span> : null}
			<span className="min-w-0 flex-1 truncate font-mono">{gate.command}</span>
			{gate.rerun === true ? <span className="text-status-running">flake re-run</span> : null}
			{gate.skipped === true ? <span className="text-muted-foreground">skipped{gate.reason === undefined ? '' : ` · ${gate.reason}`}</span> : null}
			<span className="text-muted-foreground">{formatDuration({ ms: gate.durationMs })}</span>
			<span className={hasFailed({ gate }) ? 'font-medium text-status-failed' : 'text-muted-foreground'}>{gate.exitCode ?? '—'}</span>
		</summary>
		{gate.outputTail === undefined ? (
			<p className="mt-2 text-muted-foreground">Nothing was captured for this command.</p>
		) : (
			<pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[0.7rem] leading-5">{gate.outputTail}</pre>
		)}
	</details>
);

interface Props {
	gates: GateEvidence[];
	totals: RunView['gateTotals'];
	/** Name the pipeline step each command ran under — what the gates tab adds over the same rows elsewhere. */
	showStep?: boolean;
}

/**
 * Every gate command the run ran, failures first and in full.
 *
 * Passing rows start hidden on purpose: a green run has dozens of them, and
 * left visible they bury the one command a reader opened this page for.
 */
export const GateEvidencePanel = ({ gates, totals, showStep = false }: Props) => {
	const [showPassing, setShowPassing] = useState(false);
	const failed = gates.filter((gate) => hasFailed({ gate }));
	const passing = gates.filter((gate) => !hasFailed({ gate }));

	return (
		<Card
			title="Gate evidence"
			action={
				passing.length === 0 ? null : (
					<Button type="button" variant="ghost" size="sm" onClick={() => setShowPassing(!showPassing)}>
						{showPassing ? 'Hide' : 'Show'} {formatCount({ count: passing.length, noun: 'passing gate' })}
					</Button>
				)
			}
		>
			<div className="flex flex-col gap-2">
				<p className="text-muted-foreground text-xs">
					{formatCount({ count: totals.commands, noun: 'command' })} · {formatCount({ count: totals.reruns, noun: 'flake re-run' })} · {totals.skipped} skipped
				</p>
				{gates.length === 0 ? <p className="text-muted-foreground text-sm">No gate commands were recorded for this run.</p> : null}
				{failed.map((gate) => (
					<GateRow key={`${gate.at}-${gate.command}`} gate={gate} showStep={showStep} />
				))}
				{showPassing ? passing.map((gate) => <GateRow key={`${gate.at}-${gate.command}`} gate={gate} showStep={showStep} />) : null}
			</div>
		</Card>
	);
};
