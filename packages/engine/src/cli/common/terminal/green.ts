import { paint } from '#src/cli/common/terminal/paint.ts';

export const green: (text: string) => string = paint({ code: '32' });
