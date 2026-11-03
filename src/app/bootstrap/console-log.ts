// SPDX-License-Identifier: GPL-2.0-or-later
import type { ApplicationHost } from "./application.ts";

/** Console output also goes to `log`, which decides whether the `logfile` variable asks for it. */
export function hostWithConsoleLog(host: ApplicationHost, log: (text: string) => void): ApplicationHost {
  return {
    ...host,
    print: text => {
      log(text);
      return host.print(text);
    },
  };
}
