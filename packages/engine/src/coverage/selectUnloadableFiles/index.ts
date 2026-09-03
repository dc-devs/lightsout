// The module-mode reader, the nearest-manifest reader and the ESM predicate are
// this module's private companions: each serves only the split below, and each
// is covered through it. Published here is the one answer the execution gate and
// the write-tests step both ask for.

export { selectUnloadableFiles } from '#src/coverage/selectUnloadableFiles/selectUnloadableFiles.ts';
