import { defaultAgentTimeoutMinutes } from '#src/common/constants/defaultAgentTimeoutMinutes.ts';
import { defaultCoverageSummaryPath } from '#src/common/constants/defaultCoverageSummaryPath.ts';
import { defaultExecutorFileLimit } from '#src/common/constants/defaultExecutorFileLimit.ts';
import { defaultPackagesDir } from '#src/common/constants/defaultPackagesDir.ts';
import { defaultSupervisorTimeoutMinutes } from '#src/common/constants/defaultSupervisorTimeoutMinutes.ts';
import { ConfigFieldView, type ConfigView, type LightsoutConfig } from '#src/contracts/index.ts';
import { configKeyDescriptions } from '#src/views/common/constants/configKeyDescriptions.ts';

/**
 * What each key holds here: the config's own value, or the default the engine
 * itself applies when it has a named constant for one.
 *
 * The `?? default` lines are the same expressions the engine's own readers use,
 * against the same constants — which is the point of having lifted them. A key
 * with no named default answers `undefined` and becomes a null row the page
 * reads as "default: none".
 *
 * `timeouts` appears as its two leaves rather than as the block, because the two
 * defaults are per leaf: a file that sets one must not be shown as claiming the
 * other.
 */
const configFieldReaders: Record<string, (params: { config: LightsoutConfig }) => unknown> = {
	harness: ({ config }) => config.harness,
	model: ({ config }) => config.model,
	effort: ({ config }) => config.effort,
	permissions: ({ config }) => config.permissions,
	commands: ({ config }) => config.commands,
	gates: ({ config }) => config.gates,
	'package-gates': ({ config }) => config['package-gates'],
	'packages-dir': ({ config }) => config['packages-dir'] ?? defaultPackagesDir,
	'coverage-summary-path': ({ config }) => config['coverage-summary-path'] ?? defaultCoverageSummaryPath,
	'executor-file-limit': ({ config }) => config['executor-file-limit'] ?? defaultExecutorFileLimit,
	'standards-packs': ({ config }) => config['standards-packs'],
	'standards-channels': ({ config }) => config['standards-channels'],
	'standards-checks': ({ config }) => config['standards-checks'],
	'agent-commands': ({ config }) => config['agent-commands'],
	generated: ({ config }) => config.generated,
	vendored: ({ config }) => config.vendored,
	'timeouts.agent-minutes': ({ config }) => config.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes,
	'timeouts.supervisor-minutes': ({ config }) => config.timeouts?.['supervisor-minutes'] ?? defaultSupervisorTimeoutMinutes,
	ship: ({ config }) => config.ship,
	queue: ({ config }) => config.queue,
	'auto-plan': ({ config }) => config['auto-plan'],
	docs: ({ config }) => config.docs,
};

/** The areas of the file, in the order the page reads them, and which keys land in each. */
const configSectionKeys: Array<{ title: string; keys: string[] }> = [
	{ title: 'Harness', keys: ['harness', 'model', 'effort', 'permissions', 'commands'] },
	{ title: 'Gates', keys: ['gates', 'package-gates', 'packages-dir', 'coverage-summary-path', 'executor-file-limit'] },
	{ title: 'Standards', keys: ['standards-packs', 'standards-channels', 'standards-checks'] },
	{ title: 'Agent commands', keys: ['agent-commands'] },
	{ title: 'Generated', keys: ['generated', 'vendored'] },
	{ title: 'Timeouts', keys: ['timeouts.agent-minutes', 'timeouts.supervisor-minutes'] },
	{ title: 'Ship', keys: ['ship'] },
	{ title: 'Queue', keys: ['queue'] },
	{ title: 'Auto plan', keys: ['auto-plan'] },
	{ title: 'Docs', keys: ['docs'] },
];

/**
 * A resolved value as the contract's JSON field.
 *
 * Parsed rather than cast: the field is `z.json()`, the config's block schemas
 * carry `unknown` catchalls, and running the value through the field's own
 * schema is both the narrowing and the proof that what the page will be handed
 * survives the wire.
 */
const toFieldValue = ({ value }: { value: unknown }) => ConfigFieldView.shape.value.parse(value ?? null);

interface Params {
	config: LightsoutConfig;
	declaredKeys: string[];
}

/**
 * The config's live keys grouped for the page, each row saying what it holds and
 * who decided that.
 *
 * @param config - the parsed config, which supplies every value
 * @param declaredKeys - every key the file itself wrote, the two `timeouts.` leaves spelled out, which supplies every `fromConfig`
 */
export const buildConfigSections = ({ config, declaredKeys }: Params): ConfigView['sections'] =>
	configSectionKeys.map(({ title, keys }) => ({
		title,
		fields: keys.map((key) => ({
			key,
			value: toFieldValue({ value: configFieldReaders[key]({ config }) }),
			fromConfig: declaredKeys.includes(key),
			description: configKeyDescriptions[key],
		})),
	}));
