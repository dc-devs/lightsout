import { CopyButton } from '#src/appUI/index.ts';
import { cn } from '#src/common/utils/cn.ts';

/** What a reader types into Claude Code to get this. The one command Home asks for. */
const installCommand = '/plugin marketplace add dc-devs/lightsout';

interface Props {
	className?: string;
}

/**
 * The primary call to action, which is a line to copy rather than a button to
 * press.
 *
 * The audience is on a command line already, so the shortest path from reading
 * the page to running the thing is the command itself — in mono, because mono is
 * this app's mark for text a reader takes somewhere else. The brand gradient on
 * the border is one of the three places it is spent.
 */
export const InstallLine = ({ className }: Props) => (
	<div className={cn('rounded-md bg-[image:var(--brand-gradient)] p-px', className)}>
		<div className="flex items-center gap-2 rounded-[calc(0.375rem-1px)] bg-background py-1.5 pr-1.5 pl-3">
			<code className="min-w-0 flex-1 truncate font-mono text-sm">{installCommand}</code>
			<CopyButton value={installCommand} label="Copy install command" />
		</div>
	</div>
);
