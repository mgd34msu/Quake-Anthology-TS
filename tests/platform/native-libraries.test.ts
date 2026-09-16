// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { nativeLibraryCandidates, openNativeLibrary } from "../../src/platform/native-libraries.ts";

test("Linux library discovery retains the typed approved library families", () => {
  const options = { platform: "linux", execPath: "/opt/quake/quake", environment: {} };
  expect(nativeLibraryCandidates("sdl2", options)).toEqual([
    "/opt/quake/libSDL2-2.0.so.0", "/opt/quake/libSDL2.so", "libSDL2-2.0.so.0", "libSDL2.so",
  ]);
  expect(nativeLibraryCandidates("sdl3", options)).toEqual(["/opt/quake/libSDL3.so.0", "/opt/quake/libSDL3.so", "libSDL3.so.0", "libSDL3.so"]);
  expect(nativeLibraryCandidates("gl", options)).toContain("libGL.so.1");
  expect(nativeLibraryCandidates("vorbisfile", options)).toContain("libvorbisfile.so.3");
  expect(nativeLibraryCandidates("freetype", options)).toContain("libfreetype.so.6");
});

test("explicit library override is exclusive and reports its failing path", () => {
  const options = { platform: "linux", environment: { QUAKE_SDL2_LIBRARY: "/missing/libSDL2.so" } };
  expect(nativeLibraryCandidates("sdl2", options)).toEqual(["/missing/libSDL2.so"]);
  const attempted: string[] = [];
  expect(() => openNativeLibrary("sdl2", path => {
    attempted.push(path);
    throw new Error("native loader rejected this candidate");
  }, options)).toThrow("/missing/libSDL2.so");
  expect(attempted).toEqual(["/missing/libSDL2.so"]);
  for (const value of ["", "bad\0path"])
    expect(() => nativeLibraryCandidates("sdl2", { environment: { QUAKE_SDL2_LIBRARY: value } })).toThrow("nonempty");
});

test("discovery tries candidates in order and stops at the first success", () => {
  const attempted: string[] = [];
  const result = openNativeLibrary("vorbisfile", path => {
    attempted.push(path);
    if (path.startsWith("/missing/")) throw new Error("missing packaged library");
    return { loaded: path };
  }, { platform: "linux", execPath: "/missing/quake", environment: {} });
  expect(result).toEqual({ loaded: "libvorbisfile.so.3" });
  expect(attempted).toEqual(["/missing/libvorbisfile.so.3", "/missing/libvorbisfile.so", "libvorbisfile.so.3"]);
});

test("SDL3 discovery retains exclusive override and platform library identities", () => {
  expect(nativeLibraryCandidates("sdl3", { environment: { QUAKE_SDL3_LIBRARY: "/private/SDL3" } })).toEqual(["/private/SDL3"]);
  expect(nativeLibraryCandidates("sdl3", { platform: "win32", execPath: "C:\\quake\\quake.exe", environment: {} })).toContain("SDL3.dll");
  expect(nativeLibraryCandidates("sdl3", { platform: "darwin", execPath: "/app/quake", homeDirectory: "/private/home", environment: {} })).toContain("/Library/Frameworks/SDL3.framework/SDL3");
});
