import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, FolderTree, type LucideIcon, Recycle, Scissors, WandSparkles } from 'lucide-react';
import { type ComponentType, useCallback, useState } from 'react';
import { FadeIn, Tabs } from '#src/appUI/index.ts';
import { TabsVariant } from '#src/common/constants/TabsVariant.ts';
import { cn } from '#src/common/utils/cn.ts';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';
import { BenefitId } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/BenefitId.ts';
import { codeCaps } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/codeCaps.ts';
import { SourceKind } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/constants/SourceKind.ts';
import type { SceneProps } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/common/types/SceneProps.ts';
import { FileCapScene } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/FileCapScene.tsx';
import { FolderCapScene } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/FolderCapScene.tsx';
import { ReuseScene } from '#src/features/home/screens/Home/components/CleansAsItCodesSection/components/ReuseScene.tsx';
import { usePrefersReducedMotion } from '#src/features/home/screens/Home/hooks/usePrefersReducedMotion.ts';
import { defaultPackQueryOptions } from '#src/features/packs/index.ts';

/**
 * The three things the section shows, each with the scene that shows it and a
 * line saying where in lightsout it actually happens — a reader who installs
 * will check.
 */
const benefits: Array<{
	id: BenefitId;
	title: string;
	body: string;
	source: { kind: SourceKind; name: string };
	Icon: LucideIcon;
	Scene: ComponentType<SceneProps>;
}> = [
	{
		id: BenefitId.Folders,
		title: 'Keeps folders easy to navigate',
		body: `Once a folder passes ${codeCaps.folderFiles} files, lightsout groups related files into sub-folders, so you always know where things live.`,
		source: { kind: SourceKind.StandardsPack, name: 'folder-size' },
		Icon: FolderTree,
		Scene: FolderCapScene,
	},
	{
		id: BenefitId.Files,
		title: 'Keeps files focused',
		body: `Once a file passes ${codeCaps.fileLines} lines, lightsout splits it into smaller files that each do one job, so every file reads in one sitting.`,
		source: { kind: SourceKind.StandardsPack, name: 'file-size' },
		Icon: Scissors,
		Scene: FileCapScene,
	},
	{
		id: BenefitId.Reuse,
		title: 'Keeps code DRY',
		body: 'Before writing anything, lightsout looks for code that already does the job, so nothing gets written twice.',
		source: { kind: SourceKind.Planning, name: 'duplicate check' },
		Icon: Recycle,
		Scene: ReuseScene,
	},
];

/** What each kind of source is called in the note under a benefit. */
const sourceLabels: Record<SourceKind, string> = {
	[SourceKind.StandardsPack]: 'Standards Pack',
	[SourceKind.Planning]: 'Planning',
};

/** One benefit as its tab: icon, name, the sentence that explains it, and where it happens: the Standards Pack rule or planning step, by its real name. */
const BenefitLabel = ({ benefit, isActive }: { benefit: (typeof benefits)[number]; isActive: boolean }) => (
	<span className="flex items-start gap-4">
		<span
			className={cn(
				'flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors',
				isActive ? 'bg-primary text-primary-foreground' : 'bg-primary-tint text-primary',
			)}
		>
			<benefit.Icon aria-hidden="true" className="size-5" />
		</span>
		<span className="flex min-w-0 flex-1 flex-col gap-1">
			<span className="font-bold text-base text-drop-navy">{benefit.title}</span>
			<span className="text-muted-foreground text-sm leading-relaxed">{benefit.body}</span>
			<span className="pt-1 font-medium text-primary text-xs">
				{sourceLabels[benefit.source.kind]}
				<span aria-hidden="true" className="px-1.5 text-primary/50">
					/
				</span>
				<code data-source-kind={benefit.source.kind} className="font-mono tracking-tight">
					{benefit.source.name}
				</code>
			</span>
		</span>
	</span>
);

/**
 * The section's last word: these are a sample, and the default pack holds the
 * rest. The count is read from the shipped pack, so it cannot go stale; until
 * the pack answers, the sentence stands without a number rather than with a
 * guessed one.
 */
const MoreRulesLink = () => {
	const { data: pack } = useQuery(defaultPackQueryOptions());
	const ruleCount = pack?.totals.rules;

	return (
		<p className="text-center text-muted-foreground text-base">
			These are just a few of the {ruleCount === undefined ? '' : `${ruleCount} `}rules in the default Standards Pack.{' '}
			<Link to="/standards-packs" className="inline-flex items-center gap-1 font-semibold text-primary transition-colors hover:text-primary-hover">
				See them all
				<ArrowRight aria-hidden="true" className="size-4" />
			</Link>
		</p>
	);
};

/**
 * What lightsout does to a codebase while the agent works: three things,
 * each played as a short scene beside its explanation.
 *
 * The tabs open one after another on their own until the reader picks one;
 * from then on the reader is in charge. The open scene sets the pace: the next
 * tab opens as the scene finishes its last frame, on the scene's own timer. A reader who asked for less motion
 * gets neither the cycling nor the animations — each scene shows its finished,
 * cleaned-up state.
 */
export const CleansAsItCodesSection = () => {
	const [activeId, setActiveId] = useState<BenefitId>(BenefitId.Folders);
	const [isAutoPlaying, setIsAutoPlaying] = useState(true);
	const prefersReduced = usePrefersReducedMotion();
	const isCycling = isAutoPlaying && !prefersReduced;

	// Opens the next benefit — called by the open scene as it finishes, so the
	// scene's own clock decides when, and nothing can move on mid-scene.
	const openNext = useCallback(() => {
		setActiveId((current) => benefits[(benefits.findIndex((benefit) => benefit.id === current) + 1) % benefits.length].id);
	}, []);

	const choose = (value: string) => {
		const chosen = benefits.find((benefit) => benefit.id === value);

		if (chosen !== undefined) {
			setActiveId(chosen.id);
			setIsAutoPlaying(false);
		}
	};

	return (
		<section className="relative w-full px-4 py-24">
			<div className="mx-auto flex max-w-6xl flex-col gap-14">
				<div className="flex flex-col items-center text-center">
					<FadeIn>
						<SectionPill icon={WandSparkles} label="Standards Packs in action" className="mb-8" />
					</FadeIn>
					<FadeIn delayMs={100}>
						<h2 className="font-extrabold text-4xl text-drop-navy tracking-tight md:text-5xl">
							Lightsout <span className="text-primary">cleans as it codes.</span>
						</h2>
					</FadeIn>
					<FadeIn delayMs={200}>
						<p className="mt-6 max-w-2xl text-muted-foreground text-lg leading-relaxed">
							Your Standards Pack sets the rules. Every run checks them in code and cleans up what breaks them, so your codebase gets tidier with each change
							instead of messier.
						</p>
					</FadeIn>
				</div>
				<FadeIn delayMs={300}>
					<Tabs
						variant={TabsVariant.Side}
						value={activeId}
						onValueChange={choose}
						items={benefits.map((benefit) => ({
							value: benefit.id,
							label: <BenefitLabel benefit={benefit} isActive={benefit.id === activeId} />,
							content: <benefit.Scene onFinish={isCycling ? openNext : undefined} />,
						}))}
					/>
				</FadeIn>
				<FadeIn delayMs={400}>
					<MoreRulesLink />
				</FadeIn>
			</div>
		</section>
	);
};
