import type { StandardsFinding } from '@lightsout/engine';
import { StandardsSeverity } from '@lightsout/engine/contracts';
import { Badge } from '#src/common/components/ui/Badge.tsx';
import { CopyButton } from '#src/common/components/ui/CopyButton.tsx';

interface Props {
	finding: StandardsFinding;
	/** False when no loaded rule answers to this finding's id — a package removed, renamed, or switched off since the snapshot. */
	loaded: boolean;
	onOpenRule: (rule: string) => void;
}

/**
 * One open finding: which rule found it, what it measured, and where.
 *
 * The site key is shown as it is recorded because it is the identity the
 * refactor pipeline works in — a reader cross-referencing a batch report wants
 * to paste exactly this string, so it gets its own copy control.
 *
 * A finding whose rule is no longer loaded still shows in full. Only the rule id
 * changes: there is no prose to open, so it reads as plain text with a tag
 * saying why, rather than a button that would open an empty drawer.
 */
export const FindingCard = ({ finding, loaded, onOpenRule }: Props) => (
	<article className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
		<div className="flex flex-wrap items-center gap-2">
			{loaded ? (
				<button type="button" onClick={() => onOpenRule(finding.rule)} className="font-mono text-primary text-sm underline underline-offset-2">
					{finding.rule}
				</button>
			) : (
				<span className="flex items-center gap-1.5">
					<span className="font-mono text-sm">{finding.rule}</span>
					<Badge variant="neutral">not loaded</Badge>
				</span>
			)}
			<Badge variant={finding.severity === StandardsSeverity.Blocking ? 'failed' : 'neutral'}>{finding.severity}</Badge>
		</div>
		<p className="text-sm leading-5">{finding.detail}</p>
		{finding.guidance === undefined ? null : <p className="text-muted-foreground text-xs leading-5">{finding.guidance}</p>}
		{finding.files.length === 0 ? null : (
			<ul className="flex flex-col gap-0.5 font-mono text-muted-foreground text-xs">
				{finding.files.map((file) => (
					<li key={`${file.path}:${file.startLine ?? ''}`}>
						{file.path}
						{file.startLine === undefined ? '' : `:${file.startLine}${file.endLine === undefined ? '' : `-${file.endLine}`}`}
					</li>
				))}
			</ul>
		)}
		<div className="flex items-center gap-2">
			<code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">{finding.siteKey}</code>
			<CopyButton value={finding.siteKey} label="Copy site key" />
		</div>
	</article>
);
