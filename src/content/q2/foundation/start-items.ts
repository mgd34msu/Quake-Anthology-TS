export interface Q2StartItem { readonly classname: string; readonly count: number; }

/** Player_GiveStartItems uses one pickup per semicolon entry; count belongs to that pickup. */
export function parseQ2StartItems(expression: string): readonly Q2StartItem[] {
  return expression.split(";").map(value => value.trim()).filter(value => value !== "").map(value => {
    const space = value.search(/\s/), classname = space < 0 ? value : value.slice(0, space);
    const count = space < 0 ? 1 : Number.parseInt(value.slice(space + 1).trim(), 10);
    if (!/^[a-zA-Z0-9_]+$/.test(classname) || !Number.isSafeInteger(count)) throw new Error(`Invalid Q2 starting item: ${value}`);
    return { classname, count };
  });
}
