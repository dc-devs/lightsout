import { StandardsSet, StandardsSeverity } from '@lightsout/engine/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AddressNotFound } from '#src/common/components/boundaries/AddressNotFound.tsx';
import { PackDetail, packQueryOptions, packRuleQueryOptions, showcaseRuleIds } from '#src/features/packs/index.ts';

/**
 * The URL's own word for who enforces a rule.
 *
 * The rule listing carries a boolean, and `code`/`judgment` is what a query
 * string can say without a reader having to know that `true` means code. This
 * route is the only place the two vocabularies meet.
 */
const EnforcedBy = {
	Code: 'code',
	Judgment: 'judgment',
} as const;

type EnforcedBy = (typeof EnforcedBy)[keyof typeof EnforcedBy];

/**
 * What the query string may say. Every key optional, because an absent key is
 * how the URL spells "do not narrow on this".
 */
interface PackSearch {
	set?: StandardsSet;
	channel?: string;
	enforcedBy?: EnforcedBy;
	severity?: typeof StandardsSeverity.Blocking | typeof StandardsSeverity.Advisory;
	text?: string;
}

/** A URL value from a closed vocabulary, or nothing — anything outside it ignores the filter rather than matching no rule at all. */
const readOption = <Option extends string>({ value, options }: { value: unknown; options: readonly Option[] }) => options.find((option) => option === value);

/** A free-text URL value, with an empty string read as absent so a cleared box leaves no key behind. */
const readText = ({ value }: { value: unknown }) => (typeof value === 'string' && value !== '' ? value : undefined);

const validateSearch = (search: Record<string, unknown>): PackSearch => ({
	set: readOption({ value: search.set, options: [StandardsSet.Code, StandardsSet.Tests] }),
	channel: readText({ value: search.channel }),
	enforcedBy: readOption({ value: search.enforcedBy, options: [EnforcedBy.Code, EnforcedBy.Judgment] }),
	severity: readOption({ value: search.severity, options: [StandardsSeverity.Blocking, StandardsSeverity.Advisory] }),
	text: readText({ value: search.text }),
});

/** The URL's word, as the boolean the rule listing carries. */
const readChecked = ({ enforcedBy }: { enforcedBy?: EnforcedBy }) => (enforcedBy === undefined ? undefined : enforcedBy === EnforcedBy.Code);

/** That boolean, back as the URL's word. */
const writeEnforcedBy = ({ checked }: { checked?: boolean }) => {
	let enforcedBy: EnforcedBy | undefined;

	if (checked === true) {
		enforcedBy = EnforcedBy.Code;
	}

	if (checked === false) {
		enforcedBy = EnforcedBy.Judgment;
	}

	return enforcedBy;
};

/**
 * No pack this build loads answers to the name in the path.
 *
 * Reached because `getPackServerFn` turns the engine's `StandardsPackNotFoundError`
 * into the router's own not-found signal on the server — an error class cannot
 * survive the trip across the wire, so nothing here matches one.
 */
const PackNotFound = () => {
	const { pack } = Route.useParams();

	return (
		<AddressNotFound title="No standards pack by that name.">
			Nothing this build loads is named <span className="font-mono">{pack}</span>. Pick one from the packs list.
		</AddressNotFound>
	);
};

/**
 * The route's half of the filter contract: it owns the URL, the feature owns
 * the filtering.
 *
 * Every change navigates with `replace: true`, so the back button leaves the
 * pack page rather than unwinding one filter edit at a time — and a filter
 * cleared to `undefined` drops its key from the URL entirely.
 */
const PackDetailPage = () => {
	const { pack } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	return (
		<PackDetail
			name={pack}
			filters={{
				set: search.set,
				channel: search.channel,
				checked: readChecked({ enforcedBy: search.enforcedBy }),
				severity: search.severity,
				text: search.text,
			}}
			onFiltersChange={(filters) => {
				void navigate({
					search: {
						set: filters.set,
						channel: filters.channel,
						enforcedBy: writeEnforcedBy({ checked: filters.checked }),
						severity: filters.severity,
						text: filters.text,
					},
					replace: true,
				});
			}}
		/>
	);
};

export const Route = createFileRoute('/standards/$pack/')({
	validateSearch,
	// The pack, plus the six rules the showcase strip leads with — warmed in
	// parallel so the page is server-rendered with its code rather than arriving
	// as a shell. A showcase rule that will not load is not a page error: the
	// strip skips that id, so its warm-up is deliberately swallowed here.
	loader: async ({ context, params }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(packQueryOptions({ name: params.pack })),
			...showcaseRuleIds.map((rule) => context.queryClient.ensureQueryData(packRuleQueryOptions({ name: params.pack, rule })).catch(() => undefined)),
		]);
	},
	// From the path alone, so the tab is named before the query resolves.
	head: ({ params }) => ({ meta: [{ title: `${params.pack} — standards pack` }] }),
	component: PackDetailPage,
	notFoundComponent: PackNotFound,
});
