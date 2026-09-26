import { paint } from '#src/cli/internal/common/terminal/paint.ts';

export const red: (text: string) => string = paint({ code: '31' });
