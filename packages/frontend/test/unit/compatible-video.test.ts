/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { convertCompatibleVideo, getCompatibleVideoArguments, getCompatibleVideoSettings, isVideoFile } from '@/utility/compatible-video.js';

const state = vi.hoisted(() => ({
	source: {} as any, output: {} as any, bytes: 32, code: 0, probeCode: 0, probed: '',
	load: vi.fn(), exec: vi.fn(), terminate: vi.fn(), writeFile: vi.fn(), progress: null as any,
}));
vi.mock('@/utility/video-ffmpeg.js', () => ({ createVideoFFmpeg: () => ({
	load: state.load,
	ffmpeg: {
		terminate: state.terminate, writeFile: state.writeFile, exec: state.exec, deleteFile: vi.fn(),
		on: (_: string, cb: any) => { state.progress = cb; },
		ffprobe: vi.fn(async (args: string[]) => { state.probed = args.at(-1) ?? ''; return state.probeCode; }),
		readFile: async (path: string) => path === 'probe.json'
			? JSON.stringify(state.probed === 'input' ? state.source : state.output)
			: new Uint8Array(state.bytes),
	},
}) }));

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(state, {
		source: { streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 }, { index: 1, codec_type: 'audio', codec_name: 'opus' }] },
		output: { streams: [{ codec_type: 'video', codec_name: 'h264', profile: 'Main', pix_fmt: 'yuv420p' }, { codec_type: 'audio', codec_name: 'aac', profile: 'LC' }] },
		bytes: 32, code: 0, probeCode: 0,
	});
	state.load.mockResolvedValue(true);
	state.exec.mockImplementation(async () => state.code);
});

const source = () => new File(['input'], 'input.mp4', { type: 'video/mp4' });
const convert = (level: 0 | 1 | 2 | 3 = 1, maxBytes = 100) => convertCompatibleVideo(source(), level, {
	signal: new AbortController().signal, maxBytes, onProgress: vi.fn(),
});

describe('FFmpeg compatibility conversion', () => {
	test('retains compression limits, including low at 60 fps', () => {
		expect([0, 1, 2, 3].map(level => getCompatibleVideoSettings(level as 0 | 1 | 2 | 3))).toEqual([
			{ maxSide: null, maxFps: null, audioBitrate: 192000, crf: 18 },
			{ maxSide: 1920, maxFps: 60, audioBitrate: 160000, crf: 20 },
			{ maxSide: 1280, maxFps: 30, audioBitrate: 128000, crf: 23 },
			{ maxSide: 854, maxFps: 30, audioBitrate: 96000, crf: 28 },
		]);
	});
	test('detects files with empty video MIME using their extension', () => {
		expect(isVideoFile({ name: 'clip.MOV', type: '' })).toBe(true);
		expect(isVideoFile({ name: 'photo.png', type: 'image/png' })).toBe(false);
	});
	test.each([0, 1, 2, 3] as const)('level %i always re-encodes to H.264 Main / AAC, never copies', async level => {
		await expect(convert(level)).resolves.toHaveProperty('type', 'video/mp4');
		const args = state.exec.mock.calls[0][0];
		expect(args).toContain('libx264'); expect(args).not.toContain('copy');
		expect(args).toContain('yuv420p'); expect(args).toContain('aac_low');
		expect(args).toContain('+faststart'); expect(state.terminate).toHaveBeenCalledTimes(1);
	});
	test('none has no resolution or fps cap; low limits without upscaling', () => {
		const none = getCompatibleVideoArguments(0, 0, 1);
		expect(none).not.toContain('-fpsmax'); expect(none[none.indexOf('-vf') + 1]).not.toContain('min(1,');
		const low = getCompatibleVideoArguments(1, 0, 1);
		expect(low[low.indexOf('-fpsmax') + 1]).toBe('60');
		expect(low.join(' ')).toContain('min(1,1920/');
	});
	test('selects real video rather than cover art, and retains audio', async () => {
		state.source.streams.unshift({ index: 2, codec_type: 'video', disposition: { attached_pic: 1 } });
		await convert();
		expect(state.exec.mock.calls[0][0].slice(0, 6)).toEqual(['-i', 'input', '-map', '0:0', '-map', '0:1']);
	});
	test('supports silent video without inventing an audio stream', async () => {
		state.source.streams.pop(); state.output.streams.pop();
		await convert(); expect(state.exec.mock.calls[0][0]).toContain('-an');
	});
	test('rejects HDR before execution', async () => {
		state.source.streams[0].color_transfer = 'smpte2084';
		await expect(convert()).rejects.toMatchObject({ reason: 'hdr' });
		expect(state.exec).not.toHaveBeenCalled(); expect(state.terminate).toHaveBeenCalled();
	});
	test('accepts core 0.12.10 ffprobe success status -1 with valid fresh JSON', async () => {
		state.probeCode = -1; await expect(convert()).resolves.toHaveProperty('type', 'video/mp4');
	});
	test('rejects a failed command even if a partial output exists', async () => {
		state.code = 1;
		await expect(convert()).rejects.toMatchObject({ reason: 'unsupported' });
		expect(state.terminate).toHaveBeenCalled();
	});
	test('rejects output that lost its audio track', async () => {
		state.output.streams.pop(); await expect(convert()).rejects.toMatchObject({ reason: 'unsupported' });
	});
	test('verifies actual output codec and pixel format', async () => {
		state.output.streams[0].pix_fmt = 'yuv420p10le';
		await expect(convert()).rejects.toMatchObject({ reason: 'unsupported' });
	});
	test('rejects empty output', async () => {
		state.bytes = 0; await expect(convert()).rejects.toMatchObject({ reason: 'unsupported' });
	});
	test('rejects output above the upload limit and frees the core', async () => {
		await expect(convert(1, 10)).rejects.toMatchObject({ reason: 'tooLarge' });
		expect(state.terminate).toHaveBeenCalled();
	});
	test('honors cancellation before loading the engine', async () => {
		const controller = new AbortController(); controller.abort();
		await expect(convertCompatibleVideo(source(), 1, { signal: controller.signal, maxBytes: 100, onProgress: vi.fn() })).rejects.toMatchObject({ reason: 'canceled' });
		expect(state.load).not.toHaveBeenCalled();
	});
	test('releases the worker when engine loading fails', async () => {
		state.load.mockRejectedValue(new Error('network unavailable'));
		await expect(convert()).rejects.toThrow('network unavailable');
		expect(state.terminate).toHaveBeenCalled(); expect(state.exec).not.toHaveBeenCalled();
	});
	test('aborting a running command terminates its worker', async () => {
		const controller = new AbortController();
		state.exec.mockImplementation(async () => { controller.abort(); throw new Error('terminated'); });
		await expect(convertCompatibleVideo(source(), 1, { signal: controller.signal, maxBytes: 100, onProgress: vi.fn() })).rejects.toMatchObject({ reason: 'canceled' });
		expect(state.terminate).toHaveBeenCalled();
	});
	test('serializes across separate callers and skips canceled queued work', async () => {
		let finish!: () => void;
		state.exec.mockImplementationOnce(() => new Promise<number>(resolve => { finish = () => resolve(0); }));
		const first = convert();
		await vi.waitFor(() => expect(state.exec).toHaveBeenCalledTimes(1));
		const controller = new AbortController();
		const second = convertCompatibleVideo(source(), 1, { signal: controller.signal, maxBytes: 100, onProgress: vi.fn() });
		controller.abort(); finish(); await first;
		await expect(second).rejects.toMatchObject({ reason: 'canceled' });
		expect(state.exec).toHaveBeenCalledTimes(1);
	});
	test('clamps progress and reports 100% only after verification', async () => {
		const progress = vi.fn();
		state.exec.mockImplementation(async () => { [0.8, -1, 0.2, NaN, 5].forEach(value => state.progress({ progress: value })); return 0; });
		await convertCompatibleVideo(source(), 1, { signal: new AbortController().signal, maxBytes: 100, onProgress: progress });
		expect(progress.mock.calls.map(([value]) => value)).toEqual([0, 0.8, 0.8, 0.8, 0.99, 1]);
	});
});
