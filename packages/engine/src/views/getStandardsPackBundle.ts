import { FixtureSide, type StandardsPackBundle } from '#src/contracts/index.ts';
import { listStandardsPackBundles } from '#src/views/listStandardsPackBundles.ts';
import { StandardsPackNotFoundError } from '#src/views/StandardsPackNotFoundError.ts';

/** Pass before fail, the order a rule's proof reads in — never the alphabet, which would put the counter-example first. */
const fixtureSideOrder = [FixtureSide.Pass, FixtureSide.Fail];

/**
 * The same pack with every list in a stated order.
 *
 * Everything that reads a folder here already sorts what `readdir` handed it,
 * so this changes nothing today. It is stated anyway because
 * `assets/default-pack.json` is committed and compared byte for byte in CI: the
 * one guarantee that file needs is that its order is a decision rather than a
 * filesystem's habit, and a decision belongs where the bundle is produced.
 */
const sortBundle = ({ bundle }: { bundle: StandardsPackBundle }) => ({
	...bundle,
	documents: [...bundle.documents].sort((left, right) => left.path.localeCompare(right.path)),
	rules: [...bundle.rules]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((rule) => ({
			...rule,
			fixtures: [...rule.fixtures].sort(
				(left, right) => fixtureSideOrder.indexOf(left.side) - fixtureSideOrder.indexOf(right.side) || left.path.localeCompare(right.path),
			),
		})),
});

interface Params {
	cwd: string;
	name: string;
}

/**
 * One pack whole — every document, every rule, all its prose and every fixture
 * file's text.
 *
 * The step each pack view takes before it projects, and the whole answer for the
 * web app's default-pack bundler, which commits this to
 * `assets/default-pack.json` so a build holding no repo still has a pack to
 * show.
 *
 * The lookup is by name rather than by folder because the name is what a URL
 * carries, and a name no loaded pack answers to is the not-found the route turns
 * into a 404 rather than an error page.
 *
 * @param cwd - the repo whose config decides which packs load
 * @param name - the pack's `name` from its lightsout-standards.json, which is what the URL carried
 * @throws {StandardsPackNotFoundError} When no pack this repo loads answers to the name.
 */
export const getStandardsPackBundle = async ({ cwd, name }: Params): Promise<StandardsPackBundle> => {
	const bundles = await listStandardsPackBundles({ cwd });
	const bundle = bundles.find((entry) => entry.name === name);

	if (bundle === undefined) {
		throw new StandardsPackNotFoundError({ name });
	}

	return sortBundle({ bundle });
};
