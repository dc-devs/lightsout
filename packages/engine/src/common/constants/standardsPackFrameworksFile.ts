/**
 * The module a standards pack ships to answer framework questions for the
 * engine's own mirrors of its logic — pack-relative and `/`-separated, so the
 * one use site joins it into a path on this machine.
 *
 * Held in one place because the failure is quiet: a loader looking for the wrong
 * name reads every pack as shipping no framework facts, and the mirrors go on
 * answering "nothing is framework-loaded" rather than reporting anything.
 */
export const standardsPackFrameworksFile = 'common/frameworks/getFrameworkFacts.ts';
