import type { PlanWorkspaceFile, PlanWorkspaceView } from '@lightsout/engine';
import { useState } from 'react';
import { MetadataTag } from '#src/appUI/index.ts';
import { formatBytes } from '#src/features/plans/common/utils/formatBytes.ts';
import { PlanDocumentBody } from '#src/features/plans/screens/PlanDetail/components/PlanDocumentBody.tsx';

/** A file named and sized rather than rendered — the stance the transcripts get, and what the archived phases get too. */
const FileLine = ({ file }: { file: PlanWorkspaceFile }) => (
	<li className="flex flex-wrap items-center gap-2 text-sm">
		<MetadataTag>{file.name}</MetadataTag>
		<span className="text-muted-foreground text-xs">{formatBytes({ bytes: file.bytes })}</span>
	</li>
);

/** One list of files a reader is told about and not shown; absent entirely when the workspace has none of that kind. */
const FileList = ({ title, files }: { title: string; files: PlanWorkspaceFile[] }) =>
	files.length === 0 ? null : (
		<section className="flex flex-col gap-1">
			<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{title}</h3>
			<ul className="flex flex-col gap-1">
				{files.map((file) => (
					<FileLine key={file.name} file={file} />
				))}
			</ul>
		</section>
	);

/**
 * One phase file, fetched only once a reader opens it.
 *
 * This workspace alone holds ten of them; rendering every one with the tab would
 * put a megabyte of markdown into a page nobody asked for all of.
 */
const PhaseFileRow = ({ file }: { file: PlanWorkspaceFile }) => {
	const [open, setOpen] = useState(false);

	return (
		<details className="rounded-lg border border-border bg-card px-4 py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
				<MetadataTag>{file.name}</MetadataTag>
				<span className="text-muted-foreground text-xs">{formatBytes({ bytes: file.bytes })}</span>
			</summary>
			<div className="pt-3">{open ? <PlanDocumentBody path={file.path} /> : null}</div>
		</details>
	);
};

interface Props {
	view: PlanWorkspaceView;
}

/** The drafted plan itself: the overview or the single plan, its phases, and the files this page names rather than renders. */
export const PlanTab = ({ view }: Props) => (
	<div className="flex flex-col gap-4">
		{view.planFile === undefined ? (
			<p className="text-muted-foreground text-sm">No plan drafted yet — run lightsout plan draft --name {view.listing.name}.</p>
		) : (
			<PlanDocumentBody path={view.planFile.path} />
		)}
		{view.phaseFiles.length === 0 ? null : (
			<section className="flex flex-col gap-2">
				<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">Phases</h3>
				{view.phaseFiles.map((file) => (
					<PhaseFileRow key={file.name} file={file} />
				))}
			</section>
		)}
		<FileList title="Archived" files={view.listing.implementedFiles} />
		<FileList title="Transcripts" files={view.transcripts} />
	</div>
);
