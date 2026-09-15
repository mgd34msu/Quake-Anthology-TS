import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { UnifiedAudio } from "../../src/audio/engine.ts";

if (process.env["QUAKE_STARTUP_QUEUE_CHILD"] !== "1") {
    test("startup queue lifecycle uses isolated SDL dummy output", async () => {
        const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
            env: { ...process.env, SDL_AUDIODRIVER: "dummy", SDL_AUDIO_FREQUENCY: "44100", QUAKE_STARTUP_QUEUE_CHILD: "1" },
            stdout: "pipe", stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
            child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        if (code !== 0) throw new Error(`Startup queue tests failed (${code})\n${stdout}${stderr}`);
        expect(code).toBe(0);
    });
} else {
    if (process.env["SDL_AUDIODRIVER"] !== "dummy") throw new Error("Startup queue tests require SDL dummy output");

    test("cold loading fills 200ms of actual PCM without entering running history", () => {
        using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        const samples = Int16Array.from({ length: 10000 }, (_, index) => index + 1);
        audio.queueStream({ id: "startup", audience: { kind: "world" }, gain: 1 },
            { samples, channels: 1, sampleRate: 44100, sourceSample: 0, resetStream: true });
        audio.openDevice();
        expect(audio.outputState).toBe("paused");
        expect(audio.pump(undefined, 2485.7373)).toBe(8820);
        expect(audio.outputState).toBe("playing");
        audio.pause(true);
        const pending = audio.pendingOutput;
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.length).toBeLessThanOrEqual(17640);
        expect(pending).toEqual(Int16Array.from({ length: pending.length }, (_, index) =>
            8821 - pending.length / 2 + Math.floor(index / 2)));
    });

    test("the second pump measures running work without retaining the cold sample", () => {
        using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        audio.openDevice();
        expect(audio.pump(undefined, 5000)).toBe(8820);
        audio.stopAll();
        expect(audio.pump(undefined, 151.261312)).toBe(Math.ceil(151.261312 * 44.1) + 2048);
        audio.stopAll();
        expect(audio.pump(undefined, 5000)).toBe(88200);
    });

    test("explicit startup lookahead including zero retains immediate playback", () => {
        for (const frames of [0, 400, 88200]) {
            using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
            audio.openDevice();
            expect(audio.pump(frames, 5000)).toBe(frames);
            expect(audio.sampleClock).toBe(frames);
            expect(audio.outputState).toBe("playing");
            audio.stopAll();
            expect(audio.pump()).toBe(3528);
        }
    });

    test("paused detach and output replacement retain PCM without repeating startup", () => {
        using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        audio.queueStream({ id: "startup", audience: { kind: "world" }, gain: 1 },
            { samples: new Int16Array(10000).fill(321), channels: 1, sampleRate: 44100, sourceSample: 0, resetStream: true });
        audio.openDevice();
        audio.pump(undefined, 5000);
        audio.pause(true);
        const pending = audio.pendingOutput, painted = audio.sampleClock;
        const named = audio.outputDeviceNames()[0];
        if (named === undefined) throw new Error("SDL dummy did not enumerate an output");
        audio.selectOutput(named);
        expect(audio.pendingOutput).toEqual(pending);
        audio.detachOutput();
        expect(audio.pendingOutput).toEqual(pending);
        audio.selectOutput(null);
        expect(audio.pendingOutput).toEqual(pending);
        expect(audio.sampleClock).toBe(painted);
        expect(audio.pump(undefined, 5000)).toBe(0);
        audio.stopAll();
        audio.pause(false);
        expect(audio.pump()).toBe(3528);
    });

    test("world handoff excludes the observed 8.4 second loading frame from refill history", () => {
        using previous = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        using next = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        previous.openDevice();
        previous.pump(undefined, 5000);
        previous.stopAll();
        expect(previous.pump(undefined, 5000)).toBe(88200);
        previous.stopAll();
        previous.prepareOutputTransfer(next)();
        expect(previous.outputState).toBe("detached");
        expect(next.outputState).toBe("playing");
        expect(() => next.pump(-1, 8416.735532)).toThrow("Invalid audio lookahead");
        expect(next.pump(undefined, 8416.735532)).toBe(8820);
        expect(next.sampleClock).toBe(8820);
        next.stopAll();
        expect(next.pump(undefined, 151.261312)).toBe(Math.ceil(151.261312 * 44.1) + 2048);
    });

    test("handoff preserves paused queued PCM and preparation is rollback safe", () => {
        using previous = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        using next = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
        previous.queueStream({ id: "handoff", audience: { kind: "world" }, gain: 1 },
            { samples: new Int16Array(10000).fill(321), channels: 1, sampleRate: 44100, sourceSample: 0, resetStream: true });
        previous.openDevice(); previous.pump(); previous.pause(true);
        const pending = previous.pendingOutput;
        const painted = previous.sampleClock;
        const commit = previous.prepareOutputTransfer(next);
        expect(previous.pendingOutput).toEqual(pending);
        expect(previous.outputState).toBe("paused");
        expect(next.outputState).toBe("detached");
        commit();
        expect(next.pendingOutput).toEqual(pending);
        expect(previous.sampleClock).toBe(painted);
        expect(next.sampleClock).toBe(0);
        expect(next.pump(undefined, 8416.735532)).toBe(0);
        expect(next.pendingOutput).toEqual(pending);
        next.pause(false);
        expect(next.pump(undefined, 8416.735532)).toBeLessThanOrEqual(8820);
        expect(next.sampleClock).toBeLessThanOrEqual(8820);
    });

    test("explicitly resumed output and rejected first fills preserve lifecycle", () => {
        {
            using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
            audio.openDevice();
            expect(() => audio.pump(-1, 5000)).toThrow("Invalid audio lookahead");
            expect(audio.outputState).toBe("paused");
            expect(audio.sampleClock).toBe(0);
            audio.detachOutput();
            audio.selectOutput(null);
            expect(audio.pump(undefined, 5000)).toBe(8820);
        }
        {
            using audio = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
            audio.openDevice();
            audio.pause(false);
            audio.pause(true);
            audio.pause(false);
            expect(audio.pump(undefined, 5000)).toBe(88200);
        }
    });
}
