/**
 * The file whose presence declares a folder a standards pack root — the manifest
 * every pack carries, and the only thing that tells a walk it has entered one.
 *
 * Held in one place because the modules that depend on it fail differently and
 * quietly: a walk that stops recognising pack roots reports fewer findings
 * rather than an error, while a loader that looks for the wrong name reports a
 * pack as missing.
 */
export const standardsPackRootFile = 'lightsout-standards.json';
