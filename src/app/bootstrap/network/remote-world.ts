import type { LoadedApplicationContent } from '../content.ts';
import { createSceneQueries } from '../../../world/collision/index.ts';
import type { CollisionMapSettings } from '../../../world/collision/q3/settings.ts';

/** Server admission supplies the first world; connection setup only needs mounts. */
export class RemoteWorldContent {
    private queries: ReturnType<typeof createSceneQueries> | null = null;
    private collisionSettings: CollisionMapSettings | null = null;
    constructor(private loaded: LoadedApplicationContent | null) {}
    bindCollisionSettings(settings: CollisionMapSettings): void {
        settings.registerMap();
        this.collisionSettings = settings;
        this.queries?.bindCollisionSettings(settings);
    }
    get content(): LoadedApplicationContent {
        if (this.loaded === null) throw new Error('Remote server has not supplied a world');
        return this.loaded;
    }
    set content(content: LoadedApplicationContent) { this.loaded = content; this.queries = null; }
    get scene(): ReturnType<typeof createSceneQueries> {
        if (this.queries === null) {
            this.queries = createSceneQueries(this.content.world);
            if (this.collisionSettings !== null) this.queries.bindCollisionSettings(this.collisionSettings);
        }
        return this.queries;
    }
}
