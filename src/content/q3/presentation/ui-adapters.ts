import type { UiModelPaintRequest, UiRuntimeCinematics, UiCinematicAsset } from "../../../ui/common/legacy/runtime.ts";
import type { TextDrawSink } from "../../../text/draw2d.ts";
import { vec3 } from "../../../core/math.ts";
import { qvmAnglesToAxis } from "../../../core/qvm-math.ts";
import { modelBounds } from "./model-access.ts";
import { createModelEntity, RF_LIGHTING_ORIGIN, RF_NOSHADOW } from "./ref-entity.ts";
import { createRefdef, RDF_NOWORLDMODEL } from "./refdef.ts";
import type { RendererResources } from "./resources.ts";
/** CIN ownership stays with the common media service and the calling seat. */
export interface EngineUiCinematics extends UiRuntimeCinematics {
  readonly owner: { prepare(path: string): Promise<UiCinematicAsset>; stopSlot(index: number): void; };
}
/** Source Item_Model_Paint writes directly into the shared seat draw/scene queues. */
export class EngineUiModelPainter {
  constructor(readonly resources: RendererResources, readonly commands: TextDrawSink) {}
  paint(request: UiModelPaintRequest): void {
    if (request.draw.commands !== this.commands) throw new Error("UI model painter must use its seat's drawing queue");
    const viewport = request.draw.adjust(request.rect), refdef = createRefdef();
    refdef.renderFlags = RDF_NOWORLDMODEL; refdef.viewAxis = [vec3(1,0,0),vec3(0,1,0),vec3(0,0,1)];
    refdef.x = Math.trunc(viewport.x); refdef.y = Math.trunc(viewport.y); refdef.width = Math.trunc(viewport.width); refdef.height = Math.trunc(viewport.height);
    refdef.fovX = request.fieldOfViewX !== 0 ? Math.fround(request.fieldOfViewX) : viewport.width;
    refdef.fovY = request.fieldOfViewY !== 0 ? Math.fround(request.fieldOfViewY) : viewport.height; refdef.time = request.time | 0;
    const bounds = modelBounds(request.model), entity = createModelEntity(request.model), f = Math.fround;
    const length = f(0.5 * f(bounds.max.z - bounds.min.z));
    entity.origin = vec3(f(length / f(0.268)), f(0.5 * f(bounds.min.y + bounds.max.y)), f(-0.5 * f(bounds.min.z + bounds.max.z)));
    entity.lightingOrigin = { ...entity.origin }; entity.oldOrigin = { ...entity.origin }; entity.axis = qvmAnglesToAxis(vec3(0,request.angle,0));
    entity.renderFlags = RF_LIGHTING_ORIGIN | RF_NOSHADOW; this.resources.clearScene(); this.resources.addRefEntity(entity); this.resources.renderScene(refdef);
  }
}
