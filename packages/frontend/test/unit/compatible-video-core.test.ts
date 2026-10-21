/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { File as NodeFile } from 'node:buffer';
import { beforeAll, expect, test, vi } from 'vitest';
import { convertCompatibleVideo } from '@/utility/compatible-video.js';

// Exercise the shipped WASM binary and production conversion/probing code.
// Only the browser-worker transport is replaced; no encoders or probes are mocked.
const state = vi.hoisted(() => ({ core: null as any }));
vi.mock('@/utility/video-ffmpeg.js', () => ({ createVideoFFmpeg: () => ({
	load: async () => true,
	ffmpeg: {
		writeFile: async (path: string, data: Uint8Array) => state.core.FS.writeFile(path, data),
		deleteFile: async (path: string) => state.core.FS.unlink(path),
		readFile: async (path: string, encoding = 'binary') => state.core.FS.readFile(path, { encoding }),
		ffprobe: async (args: string[]) => { state.core.ffprobe(...args); const ret = state.core.ret; state.core.reset(); return ret; },
		exec: async (args: string[]) => { state.core.exec(...args); const ret = state.core.ret; state.core.reset(); return ret; },
		on: (_: string, cb: any) => { state.core.setProgress(cb); },
		terminate: () => {},
	},
}) }));

let fixture: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
	const require = createRequire(import.meta.url);
	const createCore = require('@ffmpeg/core');
	state.core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
	state.core.setLogger(() => {});
	state.core.exec('-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=60:d=0.2',
		'-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.2',
		'-c:v', 'libx264', '-x264-params', 'repeat-headers=1', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', 'fixture.mp4');
	expect(state.core.ret).toBe(0); state.core.reset();
	fixture = new Uint8Array(state.core.FS.readFile('fixture.mp4'));
	// Corrupt avcC's SPS prefix but retain valid in-band headers. This reproduces
	// the class of files that FFmpeg recovers and WebCodecs refuses to decode.
	const avcC = Buffer.from(fixture).indexOf('avcC');
	expect(avcC).toBeGreaterThan(0);
	const length = (fixture[avcC + 10] << 8) | fixture[avcC + 11];
	fixture.copyWithin(avcC + 13, avcC + 12, avcC + 11 + length);
	state.core.exec('-f', 'lavfi', '-i', 'color=c=black:s=2080x1170:r=60:d=0.1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'wide.mp4');
	expect(state.core.ret).toBe(0); state.core.reset();
}, 30_000);

test.each([0, 1, 2, 3] as const)('real core converts damaged H.264 input at compression %i', async level => {
	// Use Node's File so the bytes pass directly into the real WASM filesystem.
	const file = new NodeFile([fixture], 'damaged.mp4', { type: 'video/mp4' });
	const result = await convertCompatibleVideo(file as unknown as File, level, {
		signal: new AbortController().signal, maxBytes: 50 * 1024 * 1024, onProgress: () => {},
	});
	expect(result.type).toBe('video/mp4'); expect(result.size).toBeGreaterThan(0);
	// Decode the ENTIRE output, including audio, rather than trusting its metadata.
	state.core.exec('-v', 'error', '-i', 'output.mp4', '-f', 'null', '-');
	expect(state.core.ret).toBe(0); state.core.reset();
	state.core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '-o', 'result.json', 'output.mp4');
	const streams = JSON.parse(state.core.FS.readFile('result.json', { encoding: 'utf8' })).streams;
	state.core.reset();
	const video = streams.find((stream: any) => stream.codec_type === 'video');
	const audio = streams.find((stream: any) => stream.codec_type === 'audio');
	expect(video).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', profile: 'Main', width: 64, height: 64 });
	expect(audio).toMatchObject({ codec_name: 'aac', profile: 'LC', sample_rate: '48000', channels: 2 });
	expect(video.avg_frame_rate).toBe(level <= 1 ? '60/1' : '30/1');
}, 30_000);


test.each([[1, 1920, 1080, '60/1'], [2, 1280, 720, '30/1'], [3, 854, 480, '30/1']] as const)(
	'real core applies compression %i resolution and fps caps', async (level, width, height, fps) => {
		const file = new NodeFile([new Uint8Array(state.core.FS.readFile('wide.mp4')).buffer], 'wide.mp4');
		await convertCompatibleVideo(file as unknown as File, level, {
			signal: new AbortController().signal, maxBytes: 50 * 1024 * 1024, onProgress: () => {},
		});
		state.core.ffprobe('-v', 'error', '-show_streams', '-of', 'json', '-o', 'dimensions.json', 'output.mp4');
		state.core.reset();
		const video = JSON.parse(state.core.FS.readFile('dimensions.json', { encoding: 'utf8' })).streams[0];
		expect(video).toMatchObject({ width, height, avg_frame_rate: fps });
	}, 30_000,
);
