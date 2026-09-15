/** A committed client frame clock, separate from transport wall timestamps. */
export class PresentationTime {
  private committedMilliseconds: number | null = null;
  advance(wallMilliseconds: number, wallElapsedMilliseconds: number, presentationElapsedMilliseconds: number): void {
    this.committedMilliseconds = (this.committedMilliseconds ?? wallMilliseconds - wallElapsedMilliseconds) + presentationElapsedMilliseconds;
  }
  get milliseconds(): number {
    if (this.committedMilliseconds === null) throw new Error("Presentation clock has no committed frame");
    return this.committedMilliseconds;
  }
}
