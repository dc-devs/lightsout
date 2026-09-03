// `getBranchStatePath` stays off this barrel: the record's location is this
// module's business, and a caller that can build the path can write the file
// without the contract the writer applies.
export { readBranchState } from '#src/queue/branchState/readBranchState.ts';
export { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
