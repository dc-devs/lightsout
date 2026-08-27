import { BookOpen } from 'lucide-react';
import { Markdown, PageHeader } from '#src/appUI/index.ts';
import { docPages } from '#src/features/docs/common/constants/docPages.ts';
import { DocToc } from '#src/features/docs/screens/DocPage/components/DocToc.tsx';

interface Props {
	/** The route param — the document's own name, `configuration` or `monorepos`. */
	doc: string;
}

/**
 * One of the repo's own documents, rendered as a page.
 *
 * Nothing is fetched: the markdown is bundled with the app, so this page works
 * on a build with no repo under it, which is most of what it is for.
 *
 * A name nothing answers to renders nothing here — the route turns that into
 * its own not-found panel before this component is reached, and returning
 * nothing is the honest answer for a caller that reaches it anyway.
 */
export const DocPage = ({ doc }: Props) => {
	const page = docPages[doc];

	return page === undefined ? null : (
		<div className="flex flex-col gap-6 p-6">
			<PageHeader icon={BookOpen} title={page.title} />
			<DocToc text={page.text} />
			<div className="max-w-3xl">
				<Markdown text={page.text} />
			</div>
		</div>
	);
};
