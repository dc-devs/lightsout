// Only the command word is published: the seven subcommand handlers are this
// module's internals, and their tests sit inside it.
export { workOrderCommand } from '#src/cli/workOrder/workOrderCommand.ts';
