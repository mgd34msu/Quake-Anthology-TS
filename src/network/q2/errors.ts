// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import { ComError } from './constants.ts';
export function Com_Error(code: number, message: string): never { throw new ComError(code, message); }
