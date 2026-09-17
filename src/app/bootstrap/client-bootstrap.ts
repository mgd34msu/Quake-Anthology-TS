import type { ApplicationKeys } from "./keys.ts";
import type { ActiveCaption } from "../../text/captions.ts";
import type { Rect, RenderCommand } from "../../contracts/render.ts";
import type { ClientDemoRecording } from "./demo-recording-commands.ts";
import type { DemoRecordingSeed, DemoRecordingSink } from "./demo-recording.ts";
import type { InputDevices } from "./input-devices.ts";
import type { ApplicationVideoRestart, PreparedVideoPresentation } from "./video-restart.ts";
import type { MusicControls } from "../../audio/music.ts";
import type { ApplicationCapture } from "./capture.ts";
import type { SeatConsole } from "../../console/session.ts";
import type { UnifiedAudio } from "../../audio/index.ts";
import type { IdentityOwner } from "../../contracts/identity.ts";
import type { ProviderReference } from "../../contracts/content.ts";
import type { SdlControllers } from "../../platform/controller.ts";
import type { ConfigStore } from "../../settings/config.ts";
import type { EngineSession, SessionClient, SessionSeat } from "../../world/session/index.ts";
import type { ControllerSettings } from "./controller-settings.ts";
import type { InputRouter } from "../../input/router.ts";
import type { ApplicationInput } from "./input.ts";
import type { ApplicationImageSettings } from "./image-settings.ts";
import type { PreparedSeat, PreparedStartup } from "./prepared-startup.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { CommandContext } from "../../contracts/common.ts";
import type { ConsoleScriptFiles } from "./config-scripts.ts";
import type { ConfigurationCommandRequest } from "./configuration.ts";
import type { ApplicationOptions } from "./options.ts";

export class ClientSourcePublicationError extends AggregateError {
  constructor(errors: readonly unknown[]) { super(errors, "Client source failed after publication began"); }
}

export interface ClientBootstrapSeat {
  readonly client: SessionClient;
  readonly seat: SessionSeat;
  readonly prepared: PreparedSeat;
}

export type ClientInputPublication = {
  readonly kind: "menu";
  readonly router: InputRouter;
  readonly controllerSettings: ControllerSettings;
  retireCommands(): void;
} | { readonly kind: "world"; readonly input: ApplicationInput };

export interface ClientRecordingFeed {
  readonly root: string;
  seed(): DemoRecordingSeed;
  attach(sink: DemoRecordingSink): () => void;
}

export interface ClientSourceLifetime {
  prepareRecording(source: CommandContext): Promise<ClientRecordingFeed>;
  prepareVideoRestart(): Promise<PreparedVideoPresentation | null>;
  readonly captureMap: string | null;
  prepareRetirement(): Promise<void>;
  releaseSettings(): void;
  retire(): Promise<void>;
}

/** Source borrowers receive the existing client objects without their final close authority. */
export interface ClientBootstrap {
  readonly keys: ApplicationKeys;
  captionCommands(captions: readonly ActiveCaption[], viewport: Rect, timeMilliseconds: number): readonly RenderCommand[];
  readonly recording: ClientDemoRecording;
  stopRecording(source: ClientSourceLifetime): Promise<void>;
  readonly videoRestart: ApplicationVideoRestart;
  readonly musicControls: MusicControls;
  readonly capture: ApplicationCapture;
  readonly consoles: Map<SessionSeat, SeatConsole>;
  readonly identity: IdentityOwner;
  readonly session: EngineSession;
  readonly locals: ClientBootstrapSeat[];
  readonly prepared: PreparedStartup;
  readonly renderer: NativeRenderer;
  readonly imageSettings: ApplicationImageSettings;
  readonly controllers: SdlControllers;
  readonly inputDevices: InputDevices;
  readonly settings: ConfigStore;
  readonly output: { current: UnifiedAudio };
  readonly platform: { current: ClientInputPublication | null };
  readonly source: { current: ClientSourceLifetime | null };
  readonly sourceProfile: { current: ProviderReference | null };
  readonly configuration: { current: { readonly scripts: ConsoleScriptFiles; readonly options: ApplicationOptions } };
  activateFrontend(configuration?: { readonly releaseCommands: Pick<CommandBuffer, "append">; publish(): void }): void;
  routeCommand(name: string, args: readonly string[], source: CommandContext): boolean;
  dispatchApplicationRequest(request: ConfigurationCommandRequest): Promise<void>;
  readonly hasPendingSource: boolean;
}
