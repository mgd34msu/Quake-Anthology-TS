import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { defaultViewInputTuning, type InputCommandBuilder } from "../../input/user-command.ts";

export function validateFieldOfView(text: string): string | null {
  const value = Number(text);
  return !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) || !Number.isFinite(value) || value < 60 || value > 160
    ? "Field of view must be between 60 and 160 degrees" : null;
}

export function bindRunCvar(cvars: CvarRegistry, builder: InputCommandBuilder): () => void {
  const defaultValue = defaultViewInputTuning(builder.dialect).alwaysRun ? "1" : "0";
  const stored = cvars.find("cl_run") !== undefined;
  cvars.register("cl_run", defaultValue, CvarFlag.Archive);
  if (!stored) cvars.set("cl_run", builder.tuning.alwaysRun ? "1" : "0");
  const validate = (value: string): string | null => value === "0" || value === "1" ? null : "Always run must be 0 or 1";
  if (validate(cvars.variableString("cl_run")) !== null) cvars.set("cl_run", builder.tuning.alwaysRun ? "1" : "0", true);
  const remove = cvars.bindValue("cl_run", { validate, changed: () => undefined });
  cvars.document("cl_run", { summary: "Always run for this player; the speed key reverses run and walk. Uses the Always run menu preference.",
    usage: "cl_run [0|1]", examples: ["cl_run 1", "set cl_run 0"], allowedValues: ["0", "1"] });
  builder.bindAlwaysRun({ read: () => cvars.variableValue("cl_run") !== 0, write: value => { cvars.set("cl_run", value ? "1" : "0"); } });
  return remove;
}
