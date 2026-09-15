import type { LoadedApplicationContent } from '../content.ts';
import { createSceneQueries } from '../../../world/collision/index.ts';

/** Server admission supplies the first world; connection setup only needs mounts. */
export class RemoteWorldContent {
    private queries: ReturnType<typeof createSceneQueries> | null = null;
    constructor(private loaded: LoadedApplicationContent | null) {}
    get content(): LoadedApplicationContent {
        if (this.loaded === null) throw new Error('Remote server has not supplied a world');
        return this.loaded;
    }
    set content(content: LoadedApplicationContent) { this.loaded = content; this.queries = null; }
    get scene(): ReturnType<typeof createSceneQueries> {
        return this.queries ??= createSceneQueries(this.content.world);
    }
}
