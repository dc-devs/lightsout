/**
 * How long a child gets to honour SIGTERM before it is killed outright.
 *
 * Shared by the two paths that end a child: a gate or harness that blew its
 * deadline, and a shutdown the user asked for. Both owe a harness the same
 * chance to flush a transcript and remove its temp files, and a run that
 * granted different amounts depending on how it ended would be reasoning
 * about the reason rather than the need.
 */
export const killGraceMs = 2_000;
