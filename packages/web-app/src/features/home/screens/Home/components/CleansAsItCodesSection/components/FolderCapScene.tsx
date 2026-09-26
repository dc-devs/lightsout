import { FileCode, Folder, FolderOpen, FolderTree } from 'lucide-react';
import { cn } from '#src/common/utils/cn.ts';
import { codeCaps } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/codeCaps.ts';
import { SceneStatus } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/SceneStatus.ts';
import type { CapSceneDefinition } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/types/CapSceneDefinition.ts';
import type { SceneProps } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/types/SceneProps.ts';
import { Appear } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/Appear.tsx';
import { CapScene } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/CapScene.tsx';
import { StatusChip } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/StatusChip.tsx';

/** The folder's files, in the order the agent adds them — one past the cap, so the last one tips it over. */
const addedFiles = [
	'Avatar',
	'Badge',
	'Banner',
	'Breadcrumb',
	'Button',
	'Card',
	'Checkbox',
	'Dialog',
	'Dropdown',
	'Footer',
	'Header',
	'Input',
	'Menu',
	'Modal',
	'Navbar',
	'Pagination',
	'Select',
	'Sidebar',
	'Tabs',
	'Toast',
	'Tooltip',
].map((name) => `${name}.tsx`);

/** The same files after the refactor pass, grouped by what they are for. */
const groupedFolders = [
	{ name: 'ui/', files: ['Avatar', 'Badge', 'Button', 'Card', 'Checkbox', 'Input', 'Select', 'Tabs', 'Tooltip'] },
	{ name: 'layout/', files: ['Banner', 'Breadcrumb', 'Footer', 'Header', 'Menu', 'Navbar', 'Pagination', 'Sidebar'] },
	{ name: 'overlays/', files: ['Dialog', 'Dropdown', 'Modal', 'Toast'] },
];

/** Frame by frame: the file count reaching the cap and one past it, then the fix, then the clean tree held a while. Short on purpose — the story is the fix, not the climb. */
const frames = [
	...[18, 19, 20].map((count) => ({ count, status: SceneStatus.Working })),
	// Two frames over the cap, so the reader has time to see what broke before the fix flies through.
	...[1, 2].map(() => ({ count: 21, status: SceneStatus.Over })),
	{ count: 21, status: SceneStatus.Fixing },
	// Held a frame longer than the file scene: the regrouped tree has more to read.
	...[1, 2, 3, 4].map(() => ({ count: 21, status: SceneStatus.Clean })),
];

/** How many of the newest files the flat listing shows; the rest are summarized above them. */
const visibleCount = 5;

const chipText = ({ count, status }: { count: number; status: SceneStatus }) => {
	if (status === SceneStatus.Fixing) {
		return 'Refactoring';
	}

	return status === SceneStatus.Over ? `${count} files · over the ${codeCaps.folderFiles}-file cap` : `${count} / ${codeCaps.folderFiles} files`;
};

/** One flat folder filling up, file by file. */
const FlatFolder = ({ count, status }: { count: number; status: SceneStatus }) => {
	const shown = addedFiles.slice(count - visibleCount, count);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p
					className={cn(
						'flex items-center gap-2.5 rounded-lg border px-3 py-2 font-medium text-drop-navy transition-colors duration-300',
						status === SceneStatus.Over ? 'border-status-failed-border bg-status-failed-light/60' : 'border-border bg-muted/50',
					)}
				>
					<FolderOpen aria-hidden="true" className="size-5 text-muted-foreground" />
					src/components
				</p>
				<StatusChip status={status}>{chipText({ count, status })}</StatusChip>
			</div>
			<ul className="flex flex-col gap-2 pl-4 font-mono text-muted-foreground-strong text-sm">
				<li className="text-subtle-foreground text-xs">… {count - visibleCount} more files</li>
				{shown.map((file, index) => (
					<li
						key={file}
						className={cn(
							'flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors duration-500',
							index === shown.length - 1 && status !== SceneStatus.Fixing && 'bg-primary-tint text-primary-hover',
						)}
					>
						<FileCode aria-hidden="true" className="size-4 shrink-0" />
						{file}
					</li>
				))}
			</ul>
		</div>
	);
};

/** How many files each sub-folder lists before the rest are summed up — enough to show what lives there, not so many the tree gets long. */
const filesPerFolder = 2;

/** The little elbow that ties a tree row to the line running down its parent, the way a file explorer draws nesting. */
const branchClasses = 'relative before:absolute before:top-1/2 before:-left-4 before:h-px before:w-3 before:bg-muted-foreground/30';

/**
 * The line running down beside a row to the next one. The last row's stops at
 * its own elbow, as a file explorer ends a branch on the last child rather
 * than trailing a line below it.
 */
const trunkClasses = 'relative after:absolute after:top-0 after:-left-4 after:h-full after:w-px after:bg-muted-foreground/30';

/**
 * The folder after the refactor pass, drawn as a file tree like the listing
 * before it: the same files, now nested in sub-folders that each sit well
 * under the cap, a couple named in each and the rest summed up.
 */
const GroupedFolder = () => (
	<Appear className="flex flex-col gap-4">
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p className="flex items-center gap-2.5 rounded-lg border border-primary-tint-border bg-primary-tint/60 px-3 py-2 font-medium text-drop-navy">
				<FolderTree aria-hidden="true" className="size-5 text-primary" />
				src/components
			</p>
			<StatusChip status={SceneStatus.Clean}>Clean · every folder under the cap</StatusChip>
		</div>
		<ul className="ml-5 flex flex-col pl-4 font-mono text-sm">
			{groupedFolders.map((folder) => (
				<li key={folder.name} className={cn('flex flex-col gap-1 pb-1 last:pb-0', trunkClasses, 'last:after:h-3.5')}>
					<p className={cn('flex items-center gap-2 py-0.5 font-semibold text-drop-navy', branchClasses)}>
						<Folder aria-hidden="true" className="size-4 shrink-0 text-primary" />
						{folder.name}
						<span className="font-normal font-sans text-subtle-foreground text-xs">{folder.files.length} files</span>
					</p>
					<ul className="ml-2 flex flex-col pl-4 text-muted-foreground-strong text-xs">
						{folder.files.slice(0, filesPerFolder).map((name) => (
							<li key={name} className={cn('flex items-center gap-2 py-0.5', branchClasses, trunkClasses)}>
								<FileCode aria-hidden="true" className="size-3.5 shrink-0" />
								{name}.tsx
							</li>
						))}
						<li className={cn('py-0.5 text-subtle-foreground', branchClasses, trunkClasses, 'after:h-1/2')}>… {folder.files.length - filesPerFolder} more</li>
					</ul>
				</li>
			))}
		</ul>
	</Appear>
);

/**
 * A folder growing past the Standards Pack's file cap, and the refactor pass
 * grouping it back under — the page's first picture of lightsout cleaning up
 * after the agent rather than after the reader.
 */
const folderScene: CapSceneDefinition<(typeof frames)[number]> = {
	title: `Standards Pack / folder-size · max ${codeCaps.folderFiles} files per folder`,
	frames,
	renderGrowing: (frame) => <FlatFolder count={frame.count} status={frame.status} />,
	renderClean: () => <GroupedFolder />,
};

export const FolderCapScene = ({ onFinish }: SceneProps) => <CapScene scene={folderScene} onFinish={onFinish} />;
