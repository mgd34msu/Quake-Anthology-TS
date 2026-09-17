/** Q1 V_StartPitchDrift / V_DriftPitch. The source supplies grounded state and ideal pitch. */
export interface PitchDriftState { readonly grounded: boolean; readonly idealPitch: number; readonly disabled: boolean; }
export class PitchDrift {
  private stopped = true;
  private velocity = 0;
  private movingSeconds = 0;
  clear(): void { this.stopped = true; this.velocity = 0; this.movingSeconds = 0; }
  sample(pitch: number, elapsedMilliseconds: number, state: PitchDriftState, manual: boolean, start: boolean,
    forward: number, forwardThreshold: number, speed = 500, delay = .15): number {
    if (manual) this.clear();
    else if (start && (this.stopped || this.velocity === 0)) { this.stopped = false; this.velocity = speed; this.movingSeconds = 0; }
    if (state.disabled || !state.grounded) { this.movingSeconds = 0; this.velocity = 0; return pitch; }
    const seconds = elapsedMilliseconds / 1000;
    if (this.stopped) {
      this.movingSeconds = manual || Math.abs(forward) < forwardThreshold ? 0 : this.movingSeconds + seconds;
      if (this.movingSeconds > delay) { this.stopped = false; this.velocity = speed; this.movingSeconds = 0; }
      return pitch;
    }
    const delta = state.idealPitch - pitch;
    if (delta === 0) { this.velocity = 0; return pitch; }
    const move = Math.min(Math.abs(delta), seconds * this.velocity);
    this.velocity += seconds * speed;
    if (move === Math.abs(delta)) this.velocity = 0;
    return pitch + Math.sign(delta) * move;
  }
}
