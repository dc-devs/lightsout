import { FileCode, FolderTree } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';
import { codeCaps } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/codeCaps.ts';
import { SceneStatus } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/constants/SceneStatus.ts';
import type { CapSceneDefinition } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/types/CapSceneDefinition.ts';
import type { SceneProps } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/common/types/SceneProps.ts';
import { Appear } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/Appear.tsx';
import { CapScene } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/CapScene.tsx';
import { StatusChip } from '#src/features/home/screens/Home/internal/components/CleansAsItCodesSection/internal/components/StatusChip.tsx';

/** How tall one line of code is drawn, in pixels — the scale that turns a line count into a file you can see growing. */
const pxPerLine = 1;

/** Where the file ends up: far enough past the cap that the overflow reads at a glance, and a split rather than a trim is the obvious fix. */
const finalLines = codeCaps.fileLines + 40;

/** The one file, split into a folder of focused pieces — the same lines, now in three files that each read in one sitting. */
const splitFiles = [
	{ folder: 'runReport/', name: 'runReport.ts', lines: 118 },
	{ folder: 'runReport/common/utils/', name: 'summarizeSteps.ts', lines: 96 },
	{ folder: 'runReport/common/utils/', name: 'formatCost.ts', lines: finalLines - 118 - 96 },
];

/** Frame by frame: the file growing up to its cap and past it, then the fix, then the split held a while. */
const frames = [
	...[180, codeCaps.fileLines].map((lines) => ({ lines, status: SceneStatus.Working })),
	{ lines: finalLines, status: SceneStatus.Over },
	{ lines: finalLines, status: SceneStatus.Fixing },
	...[1, 2, 3].map(() => ({ lines: finalLines, status: SceneStatus.Clean })),
];

/** Widths for the placeholder code lines — more than any file here needs, so the box's height alone decides how many show. */
const codeLineWidths = [72, 54, 88, 40, 66, 80, 48, 92, 58, 70, 36, 84, 62, 76, 44, 90, 52, 68, 38, 86];

/** The file drawn as a box of code whose height is its line count; the box grows smoothly when the count changes. */
const CodeBlock = ({ lines, className }: { lines: number; className?: string }) => (
	<div
		aria-hidden="true"
		className={cn('flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-muted/50 p-3 transition-[height] duration-700 ease-out', className)}
		style={{ height: `${lines * pxPerLine}px` }}
	>
		{codeLineWidths.map((width) => (
			<span key={width} className="h-1.5 shrink-0 rounded-full bg-border" style={{ width: `${width}%` }} />
		))}
	</div>
);

/** The cap, drawn as a dashed line at the height a file of exactly that many lines reaches. */
const LimitLine = () => (
	<div
		aria-hidden="true"
		className="absolute inset-x-0 z-10 border-drop-navy/40 border-t-2 border-dashed"
		style={{ top: `${codeCaps.fileLines * pxPerLine}px` }}
	>
		<span className="absolute right-0 -top-5 font-mono text-[11px] text-subtle-foreground">{codeCaps.fileLines}-line limit</span>
	</div>
);

/** The one file, growing down the window toward the limit line and past it, the part past the line in red. */
const GrowingFile = ({ lines, status }: { lines: number; status: SceneStatus }) => (
	<div className="flex flex-col gap-4">
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="flex items-center gap-2.5 font-medium font-mono text-drop-navy text-sm">
				<FileCode aria-hidden="true" className="size-5 text-muted-foreground" />
				runReport.ts
			</p>
			<StatusChip status={status}>{status === SceneStatus.Fixing ? 'Refactoring' : `${lines} / ${codeCaps.fileLines} lines`}</StatusChip>
		</div>
		<div className="relative" style={{ height: `${finalLines * pxPerLine}px` }}>
			<LimitLine />
			<CodeBlock lines={lines} className="absolute inset-x-0 top-0" />
			<div
				aria-hidden="true"
				className="absolute inset-x-0 rounded-b-lg border-status-failed-border border-x border-b bg-status-failed/10 transition-[height] duration-700 ease-out"
				style={{ top: `${codeCaps.fileLines * pxPerLine}px`, height: `${Math.max(lines - codeCaps.fileLines, 0) * pxPerLine}px` }}
			/>
		</div>
	</div>
);

/**
 * The same code after the refactor pass: three files side by side, drawn
 * identically on a clean white card — the calm after the overflow, with each
 * file's own size left to the number under it.
 */
const SplitFiles = () => (
	<Appear className="flex flex-col gap-4">
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="flex items-center gap-2.5 font-medium font-mono text-drop-navy text-sm">
				<FolderTree aria-hidden="true" className="size-5 text-primary" />
				runReport/
			</p>
			<StatusChip status={SceneStatus.Clean}>Clean · every file under the cap</StatusChip>
		</div>
		<ul className="grid grid-cols-3 gap-4 pt-2">
			{splitFiles.map((file) => (
				<li key={file.name} className="flex min-w-0 flex-col gap-3">
					<div aria-hidden="true" className="flex h-36 flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
						{codeLineWidths.slice(0, 7).map((width) => (
							<span key={width} className="h-1.5 shrink-0 rounded-full bg-border" style={{ width: `${width}%` }} />
						))}
					</div>
					<p className="flex min-w-0 flex-col font-mono text-xs">
						<span className="truncate font-medium text-drop-navy">{file.name}</span>
						<span className="truncate text-subtle-foreground">{file.folder}</span>
						<span className="text-muted-foreground">{file.lines} lines</span>
					</p>
				</li>
			))}
		</ul>
	</Appear>
);

/** An ordinary source file growing past the Standards Pack's line cap, and the refactor pass splitting it into a folder. */
const fileScene: CapSceneDefinition<(typeof frames)[number]> = {
	title: `Standards Pack / file-size · max ${codeCaps.fileLines} lines per file`,
	frames,
	renderGrowing: (frame) => <GrowingFile lines={frame.lines} status={frame.status} />,
	renderClean: () => <SplitFiles />,
};

export const FileCapScene = ({ onFinish }: SceneProps) => <CapScene scene={fileScene} onFinish={onFinish} />;
