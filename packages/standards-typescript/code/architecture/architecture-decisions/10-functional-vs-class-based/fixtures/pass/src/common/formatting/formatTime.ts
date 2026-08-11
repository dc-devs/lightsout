// "How many formatTimes exist right now?" is a nonsensical question — so it is
// a function, one per file, with no class to bind them together.
export const formatTime = ({ date }: { date: Date }): string => date.toISOString().slice(11, 19);
