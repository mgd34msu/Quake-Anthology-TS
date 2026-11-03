// SPDX-License-Identifier: GPL-2.0-or-later
const SERVED_EXTENSIONS = /\.(?:bsp|ent|lit|loc|mdl|md2|md3|spr|sp2|lmp|wal|pcx|tga|png|jpg|jpeg|bmp|gif|wav|ogg|cin|dm2|txt)$/i;

/** Native server downloads serve game assets only, never configuration or scripts that happen to sit in a mounted directory. */
export function isServedDownloadType(path: string): boolean {
  return SERVED_EXTENSIONS.test(path);
}
