/* quakec_mg3/math.qc: cos() takes degrees and is computed through makevectors. GPL-2.0-or-later. */
export function qcCos(degrees: number): number { return Math.fround(Math.cos(Math.fround(degrees) * Math.PI / 180)); }
