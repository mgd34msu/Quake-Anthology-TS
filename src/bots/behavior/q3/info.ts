import { setInfoValue } from "../../../core/cvars/info.ts";

export function infoSetValueForKey(input: string, key: string, value: string, print: (text: string) => void): string {
  return setInfoValue(input, key, value, { dialect: "q3", maximumLength: 1024,
    target: "client-userinfo", serverHighCharacters: true, print });
}
