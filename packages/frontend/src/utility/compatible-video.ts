/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

export function isVideoFile(file: Pick<File, 'name' | 'type'>) {
	return file.type.startsWith('video/') || /\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg|mts|m2ts)$/i.test(file.name);
}

export type VideoCompressionLevel = 0 | 1 | 2 | 3;

export class CompatibleVideoError extends Error {
	constructor(public readonly reason: 'unsupported' | 'hdr' | 'tooLarge' | 'canceled') {
		super(reason);
	}
}

export function getCompatibleVideoSettings(level: VideoCompressionLevel) {
	return [
		{ maxSide: null, maxFps: null, audioBitrate: 192_000, crf: 18 },
		{ maxSide: 1920, maxFps: 60, audioBitrate: 160_000, crf: 20 },
		{ maxSide: 1280, maxFps: 30, audioBitrate: 128_000, crf: 23 },
		{ maxSide: 854, maxFps: 30, audioBitrate: 96_000, crf: 28 },
	][level];
}

interface VideoProbe {
	streams?: {
		index: number;
		codec_type?: string;
		codec_name?: string;
		profile?: string;
		pix_fmt?: string;
		width?: number;
		height?: number;
		color_transfer?: string;
		disposition?: { attached_pic?: number };
		side_data_list?: { side_data_type?: string }[];
	}[];
}

export function getCompatibleVideoArguments(level: VideoCompressionLevel, videoIndex: number, audioIndex?: number) {
	const { maxSide, maxFps, audioBitrate, crf } = getCompatibleVideoSettings(level);
	// FFmpeg autorotates before this filter. Normalize anamorphic pixels, keep the
	// display aspect ratio, never upscale, and round down to even dimensions.
	const factor = maxSide == null ? '1' : `min(1,${maxSide}/max(iw*sar,ih))`;
	const scale = `scale=w='max(2,trunc(iw*sar*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)',setsar=1`;
	return [
		'-i', 'input', '-map', `0:${videoIndex}`,
		...(audioIndex == null ? ['-an'] : ['-map', `0:${audioIndex}`]),
		'-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
		'-vf', scale,
		...(maxFps == null ? [] : ['-fpsmax', String(maxFps)]),
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
		'-profile:v', 'main', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1',
		'-threads', '1', '-filter_threads', '1',
		'-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', String(audioBitrate), '-ar', '48000', '-ac', '2',
		'-movflags', '+faststart', 'output.mp4',
	];
}

async function probe(ffmpeg: FFmpeg, path: string): Promise<VideoProbe> {
	const code = await ffmpeg.ffprobe(['-v', 'error', '-show_streams', '-of', 'json', '-o', 'probe.json', path]);
	// Core 0.12.10 leaves ret at -1 on a successful ffprobe call. Require
	// fresh, parseable metadata instead of assuming its exit status is always 0.
	if (code !== 0 && code !== -1) throw new CompatibleVideoError('unsupported');
	const data = await ffmpeg.readFile('probe.json', 'utf8');
	await ffmpeg.deleteFile('probe.json');
	if (typeof data !== 'string') throw new CompatibleVideoError('unsupported');
	return JSON.parse(data) as VideoProbe;
}

let conversionQueue: Promise<unknown> = Promise.resolve();

/** Serialize across uploader instances too: each core owns a large WASM heap. */
export function convertCompatibleVideo(file: File, level: VideoCompressionLevel, options: {
	signal: AbortSignal;
	maxBytes: number;
	onProgress: (progress: number) => void;
}): Promise<Blob> {
	const task = conversionQueue.then(() => convert(file, level, options));
	conversionQueue = task.catch(() => {});
	return task;
}

/** Always software-decode and re-encode, including compression level "none". */
async function convert(file: File, level: VideoCompressionLevel, options: {
	signal: AbortSignal;
	maxBytes: number;
	onProgress: (progress: number) => void;
}): Promise<Blob> {
	const checkCanceled = () => {
		if (options.signal.aborted) throw new CompatibleVideoError('canceled');
	};
	checkCanceled();
	const { createVideoFFmpeg } = await import('./video-ffmpeg.js');
	checkCanceled();
	const { ffmpeg, load } = createVideoFFmpeg();
	const cancel = () => ffmpeg.terminate();
	options.signal.addEventListener('abort', cancel, { once: true });
	let loadTimer: number | undefined;
	try {
		checkCanceled();
		// Worker startup/network failures must not leave the uploader waiting forever.
		await Promise.race([
			load(),
			new Promise<never>((_, reject) => {
				loadTimer = window.setTimeout(() => reject(new CompatibleVideoError('unsupported')), 120_000);
			}),
		]);
		window.clearTimeout(loadTimer);
		checkCanceled();
		const bytes = new Uint8Array(await file.arrayBuffer());
		checkCanceled();
		await ffmpeg.writeFile('input', bytes);
		const source = await probe(ffmpeg, 'input');
		const video = source.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
		const audio = source.streams?.find(stream => stream.codec_type === 'audio');
		if (!video || !video.width || !video.height) throw new CompatibleVideoError('unsupported');
		if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer ?? '') ||
			video.side_data_list?.some(data => /Mastering display|Content light level/.test(data.side_data_type ?? ''))) {
			throw new CompatibleVideoError('hdr');
		}
		checkCanceled();
		let lastProgress = 0;
		ffmpeg.on('progress', ({ progress }) => {
			if (options.signal.aborted || !Number.isFinite(progress)) return;
			lastProgress = Math.max(lastProgress, Math.max(0, Math.min(0.99, progress)));
			options.onProgress(lastProgress);
		});
		options.onProgress(0);
		const code = await ffmpeg.exec(getCompatibleVideoArguments(level, video.index, audio?.index));
		checkCanceled();
		// Core may print "Aborted()" even on success. Use the exit code and output.
		if (code !== 0) throw new CompatibleVideoError('unsupported');
		const output = await probe(ffmpeg, 'output.mp4');
		const resultVideo = output.streams?.find(stream => stream.codec_type === 'video');
		const resultAudio = output.streams?.find(stream => stream.codec_type === 'audio');
		if (resultVideo?.codec_name !== 'h264' || resultVideo.pix_fmt !== 'yuv420p' ||
			!['Constrained Baseline', 'Baseline', 'Main', 'High'].includes(resultVideo.profile ?? '') ||
			(audio && (resultAudio?.codec_name !== 'aac' || resultAudio.profile !== 'LC'))) {
			throw new CompatibleVideoError('unsupported');
		}
		const data = await ffmpeg.readFile('output.mp4');
		checkCanceled();
		if (typeof data === 'string' || !data.byteLength) throw new CompatibleVideoError('unsupported');
		if (data.byteLength > options.maxBytes) throw new CompatibleVideoError('tooLarge');
		const result = new Blob([new Uint8Array(data).buffer], { type: 'video/mp4' });
		options.onProgress(1);
		return result;
	} catch (err) {
		if (options.signal.aborted) throw new CompatibleVideoError('canceled');
		throw err;
	} finally {
		window.clearTimeout(loadTimer);
		options.signal.removeEventListener('abort', cancel);
		// Release input, output, decoder buffers and WASM heap after every job.
		ffmpeg.terminate();
	}
}
