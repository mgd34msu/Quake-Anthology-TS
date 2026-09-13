import { CvarFlag, Q2CvarFlag } from '../../../core/cvars/index.ts';
import type { CvarRegistry } from '../../../core/cvars/index.ts';

export type ClientDownloadCategory = 'metadata' | 'package' | 'map' | 'model' | 'sound' | 'player' | 'picture';
export type ClientDownloadPermission = (request: { readonly transport: 'http' | 'native'; readonly category: ClientDownloadCategory }) => boolean;

export function clientDownloadCategory(path: string): ClientDownloadCategory {
    const name = path.toLowerCase();
    if (/\.(pak|pkz|pk3)$/.test(name)) return 'package';
    if (/^(maps|env|textures)\//.test(name)) return 'map';
    if (name.startsWith('players/')) return 'player';
    if (name.startsWith('models/')) return 'model';
    if (name.startsWith('sound/')) return 'sound';
    return 'picture';
}

/** Local automatic-transfer policy; this never changes the server's download rules. */
export function createClientDownloadPermission(cvars: CvarRegistry, family: 'q2' | 'q3'): ClientDownloadPermission {
    const archive = family === 'q2' ? Q2CvarFlag.Archive : CvarFlag.Archive;
    if (family === 'q3') {
        cvars.register('cl_allowDownload', '0', archive);
        return () => (cvars.get('cl_allowDownload')?.integerValue ?? 0) !== 0;
    }
    cvars.register('allow_download', '1', archive);
    cvars.register('cl_http_downloads', '1', archive);
    for (const category of ['maps', 'models', 'sounds', 'players']) cvars.register(`allow_download_${category}`, '1', archive);
    const categoryAllowed = (category: ClientDownloadCategory): boolean => {
        switch (category) {
            case 'map': return cvars.variableValue('allow_download_maps') !== 0;
            case 'model': return cvars.variableValue('allow_download_models') !== 0;
            case 'sound': return cvars.variableValue('allow_download_sounds') !== 0;
            case 'player': return cvars.variableValue('allow_download_players') !== 0;
            // Archives can contain every category; never use them to bypass an asset restriction.
            case 'package': return ['maps', 'models', 'sounds', 'players'].every(name => cvars.variableValue(`allow_download_${name}`) !== 0);
            case 'metadata': case 'picture': return true;
        }
    };
    // Correct the donor's -1 inconsistency: nonpositive disables HTTP and native automatic transfers.
    return request => cvars.variableValue('allow_download') > 0
        && (request.transport !== 'http' || cvars.variableValue('cl_http_downloads') !== 0) && categoryAllowed(request.category);
}
