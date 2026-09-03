// The glob matcher, the config reader and the collected-file predicate are this
// module's private companions: each serves only the split below, and each is
// covered through it. Published here is the one answer the execution gate and
// the write-tests step both ask for.

export { selectCollectedFiles } from '#src/coverage/selectCollectedFiles/selectCollectedFiles.ts';
