import type { ActorCommand } from '../../../contracts/session.ts';
import type { QwUserCommand } from '../../../contracts/protocol.ts';
import type { QuakeWorldMessage } from '../../../network/q1/quakeworld.ts';
export type QwServerData = Extract<QuakeWorldMessage, { kind: 'server-data' }>;
export interface QwApplicationDownloads {
    request(path: string, category: 'sound' | 'model' | 'skin'): Promise<'available' | 'waiting' | 'skipped'>;
    receive(result: Extract<QuakeWorldMessage, { kind: 'download' }>['result']): Promise<'waiting' | 'complete' | 'missing'>;
    close(): void;
}
export interface QwApplicationClientHost {
    readonly downloads?: QwApplicationDownloads;
    readonly skins?: {
        names(): readonly string[];
        loading(value: boolean): void;
        prepare(): Promise<void>;
    };
    readonly prediction?: {
        sent(sequence: number, command: QwUserCommand, nowMilliseconds: number): void;
        acknowledged(sequence: number, nowMilliseconds: number): void;
    };
    serverData(data: QwServerData): Promise<void>;
    gameState(data: QwServerData, models: readonly string[], sounds: readonly string[]): Promise<number>;
    receive(messages: readonly QuakeWorldMessage[], nowMilliseconds: number): Promise<void>;
    command(command: ActorCommand): QwUserCommand;
    disconnected(reason: string): void;
    print(text: string): void;
}
