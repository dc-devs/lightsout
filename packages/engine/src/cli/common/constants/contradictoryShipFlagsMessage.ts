/**
 * What both ways into ship say when `--ship` and `--no-ship` are typed
 * together.
 *
 * `implementCommand` refuses before the run starts and `exitAfterImplement`
 * refuses after it; a user who hits it one way must not be told something else
 * the other way.
 */
export const contradictoryShipFlagsMessage = '--ship and --no-ship contradict each other — pass at most one';
