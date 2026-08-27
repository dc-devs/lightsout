import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { DocPage, docPages } from '#src/features/docs/index.ts';

/**
 * The path names no document this build carries.
 *
 * There is no docs index to send a reader back to, so the way out is the
 * configuration doc — the same target the site bar's own Docs entry points at.
 */
const DocNotFound = () => (
	<AddressNotFound title="No doc at that address.">
		That doc does not exist —{' '}
		<Link to="/docs/$doc" params={{ doc: 'configuration' }} className="text-brand-to underline underline-offset-4">
			read the configuration doc
		</Link>
		.
	</AddressNotFound>
);

const DocRoutePage = () => {
	const { doc } = Route.useParams();

	return <DocPage doc={doc} />;
};

export const Route = createFileRoute('/_site/docs/$doc')({
	// The markdown is bundled with the app, so there is nothing to fetch — the
	// loader only decides whether the path names a document at all.
	loader: ({ params }) => {
		if (docPages[params.doc] === undefined) {
			throw notFound();
		}
	},
	head: ({ params }) => ({ meta: [{ title: `${docPages[params.doc]?.title ?? 'Docs'} — lightsout` }] }),
	component: DocRoutePage,
	notFoundComponent: DocNotFound,
});
