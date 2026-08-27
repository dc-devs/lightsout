import type { StandardsPackDocumentView, StandardsPackRuleListing } from '@lightsout/engine';
import { Markdown, SectionHeader } from '#src/appUI/index.ts';
import { groupRulesByDocument } from '#src/features/packs/common/utils/groupRulesByDocument.ts';
import { PackRuleRow } from '#src/features/packs/screens/PackDetail/components/PackRuleRow.tsx';

/**
 * One document and the rules stated in it.
 *
 * The document's own introduction is collapsed: a reader scanning for a rule
 * wants the list, and a reader who has found the document wants the argument
 * that frames it.
 */
const DocumentSection = ({ document, rules, packName }: { document: StandardsPackDocumentView; rules: StandardsPackRuleListing[]; packName: string }) => (
	<section className="flex flex-col gap-3">
		<SectionHeader title={<span className="font-mono text-sm">{document.path}</span>} description={`${document.set} · ${document.channel}`} />
		{document.intro === '' ? null : (
			<details className="rounded-md border border-border bg-card px-3 py-2">
				<summary className="cursor-pointer text-muted-foreground text-xs">What this document argues</summary>
				<Markdown text={document.intro} />
			</details>
		)}
		<div className="flex flex-col gap-2">
			{rules.map((rule) => (
				<PackRuleRow key={rule.id} rule={rule} packName={packName} />
			))}
		</div>
	</section>
);

interface Props {
	documents: StandardsPackDocumentView[];
	rules: StandardsPackRuleListing[];
	packName: string;
}

/**
 * The pack's rules under the document each is stated in, in the order the pack
 * assembles them.
 *
 * Rendered only when at least one rule survived the filters — the empty state
 * belongs to the page, which is also where the control that clears them is.
 */
export const RulesByDocument = ({ documents, rules, packName }: Props) => (
	<div className="flex flex-col gap-8">
		{groupRulesByDocument({ documents, rules }).map(({ document, rules: documentRules }) => (
			<DocumentSection key={document.path} document={document} rules={documentRules} packName={packName} />
		))}
	</div>
);
