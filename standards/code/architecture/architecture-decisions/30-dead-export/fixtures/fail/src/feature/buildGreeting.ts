// Nothing in this repo mentions `buildGreeting` — no module, no barrel, no
// test. Version control has its history; the file does not need to keep it.
export const buildGreeting = ({ name }: { name: string }): string => `Hello, ${name}.`;
