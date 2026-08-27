/**
 * The three frozen runs the site's proof section shows, named by what each one
 * demonstrates rather than by a run id.
 *
 * Run ids are local to the machine that recorded them, so the slug is what the
 * app addresses a demo run by and what `scripts/freezeDemoRuns.mjs` names its
 * output files.
 */
export const DemoRunSlug = { Implement: 'implement', Refactor: 'refactor', Stopped: 'stopped' } as const;

export type DemoRunSlug = (typeof DemoRunSlug)[keyof typeof DemoRunSlug];
