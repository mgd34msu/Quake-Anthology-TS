/* WinQuake SV_SpawnServer and PF_precache_model/PF_precache_sound. GPL-2.0-or-later. */
import type { Q1PrecacheTables } from './types.ts';

/** Ordered names project source declarations; mounted content still owns resource bytes. */
export class Q1PrecacheRegistry implements Q1PrecacheTables {
  private state: 'loading' | 'frozen' = 'loading';
  private readonly modelNames = [''];
  private readonly soundNames = [''];
  private readonly modelIndices = new Map<string, number>([['', 0]]);
  private readonly soundIndices = new Map<string, number>([['', 0]]);

  get phase(): 'loading' | 'frozen' { return this.state; }
  get models(): readonly string[] { return this.modelNames; }
  get sounds(): readonly string[] { return this.soundNames; }

  beginWorld(path: string, inlineModels: number): void {
    if (this.state !== 'loading' || this.modelNames.length !== 1 || this.soundNames.length !== 1)
      throw new Error('Q1 world precaches must precede source spawn declarations');
    if (!Number.isInteger(inlineModels) || inlineModels < 0) throw new Error('Invalid Q1 inline model count');
    this.model(path);
    for (let ordinal = 1; ordinal <= inlineModels; ordinal++) this.model(`*${ordinal}`);
  }

  model(path: string): string { return this.declare(path, this.modelNames, this.modelIndices); }
  sound(path: string): string { return this.declare(path, this.soundNames, this.soundIndices); }
  freeze(): void { this.state = 'frozen'; }

  restore(tables: Q1PrecacheTables): void {
    if (this.state !== 'loading' || this.modelNames.length !== 1 || this.soundNames.length !== 1)
      throw new Error('Restore Q1 precaches into a fresh registry');
    const validate = (names: readonly string[]): Map<string, number> => {
      if (names[0] !== '') throw new Error('Saved Q1 precache slot zero must be empty');
      const indices = new Map<string, number>();
      for (const [index, path] of names.entries()) {
        if (indices.has(path) || (index !== 0 && (path.length === 0 || path.charCodeAt(0) <= 32 || path.includes('\0'))))
          throw new Error('Invalid saved Q1 precache declaration');
        indices.set(path, index);
      }
      return indices;
    };
    const models = validate(tables.models), sounds = validate(tables.sounds);
    this.modelNames.splice(0, this.modelNames.length, ...tables.models);
    this.soundNames.splice(0, this.soundNames.length, ...tables.sounds);
    this.modelIndices.clear(); this.soundIndices.clear();
    for (const [path, index] of models) this.modelIndices.set(path, index);
    for (const [path, index] of sounds) this.soundIndices.set(path, index);
    this.state = tables.phase;
  }

  private declare(path: string, names: string[], indices: Map<string, number>): string {
    if (this.state !== 'loading') throw new Error('Q1 precache can only be done in spawn functions');
    if (path.length === 0 || path.charCodeAt(0) <= 32 || path.includes('\0')) throw new Error('Invalid Q1 precache string');
    if (!indices.has(path)) { indices.set(path, names.length); names.push(path); }
    return path;
  }
}
