import type { AgentInvocation, RunStepView, RunUsage } from '@lightsout/engine';
import { formatCost, formatTokenCount } from '@lightsout/shared';
import { Card } from '#src/appUI/index.ts';
import { formatCount } from '#src/common/formatting/formatCount.ts';

/**
 * How much of the run's input came out of cache, drawn rather than parenthesised.
 *
 * It is the number that decides what a long run costs — a run reading 90% from
 * cache and one reading 30% are different orders of spend — and a bar says that
 * at a glance where a figure inside a sentence does not.
 */
const CacheReadBar = ({ share }: { share: number }) => {
	const percent = Math.round(share * 100);

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between text-xs">
				<span className="text-muted-foreground">read from cache</span>
				<span className="font-medium">{percent}%</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div style={{ width: `${percent}%` }} className="h-full rounded-full bg-status-passed" />
			</div>
		</div>
	);
};

interface Props {
	usage?: RunUsage;
	/** Share of all input the model read from cache, as the engine computed it. */
	cacheReadShare?: number;
	steps: RunStepView[];
	agents: AgentInvocation[];
	/** Final messages that failed their contract and cost a re-emit retry. */
	rejectedReports: number;
}

/**
 * What the agents cost: the run total, the same split per step, and every
 * invocation the ledger recorded.
 *
 * Rejected reports are called out when there are any, because that number is
 * what a re-emit cost — an invocation that produced nothing usable still shows
 * up in the totals above it.
 */
export const AgentCostPanel = ({ usage, cacheReadShare, steps, agents, rejectedReports }: Props) => (
	<Card title="Agent cost">
		{usage === undefined ? (
			<p className="text-muted-foreground text-sm">This run's driver reported no usage.</p>
		) : (
			<div className="flex flex-col gap-4">
				<p className="text-sm">
					in {formatTokenCount({ count: usage.inputTokens })} · out {formatTokenCount({ count: usage.outputTokens })} · cache-read{' '}
					{formatTokenCount({ count: usage.cacheReadTokens })} · {formatCost({ usd: usage.costUsd })} ·{' '}
					{formatCount({ count: usage.invocations, noun: 'invocation' })}
				</p>
				{cacheReadShare === undefined ? null : <CacheReadBar share={cacheReadShare} />}
				{rejectedReports === 0 ? null : (
					<p className="text-muted-foreground-strong text-xs">{formatCount({ count: rejectedReports, noun: 'rejected report' })} re-emitted</p>
				)}
				<table className="w-full border-collapse text-left text-xs">
					<thead className="border-border border-b text-muted-foreground">
						<tr>
							<th className="py-1.5 pr-3 font-medium">pipeline step</th>
							<th className="py-1.5 pr-3 font-medium">invocations</th>
							<th className="py-1.5 pr-3 font-medium">output tokens</th>
							<th className="py-1.5 font-medium">spend</th>
						</tr>
					</thead>
					<tbody>
						{steps.map((step) => (
							<tr key={step.id} className="border-border border-b last:border-0">
								<td className="py-1.5 pr-3 font-mono">{step.id}</td>
								<td className="py-1.5 pr-3">{step.invocations}</td>
								<td className="py-1.5 pr-3">{formatTokenCount({ count: step.outputTokens })}</td>
								<td className="py-1.5">{formatCost({ usd: step.costUsd })}</td>
							</tr>
						))}
					</tbody>
				</table>
				<ul className="flex flex-col gap-1 text-muted-foreground text-xs">
					{agents.map((agent) => (
						<li key={`${agent.at}-${agent.step}`} className="flex flex-wrap items-center gap-x-2">
							<span className="font-mono">{agent.step}</span>
							{agent.model === undefined ? null : <span>{agent.model}</span>}
							{agent.effort === undefined ? null : <span>{agent.effort}</span>}
							<span>out {formatTokenCount({ count: agent.outputTokens })}</span>
							<span>{formatCost({ usd: agent.costUsd })}</span>
						</li>
					))}
				</ul>
			</div>
		)}
	</Card>
);
