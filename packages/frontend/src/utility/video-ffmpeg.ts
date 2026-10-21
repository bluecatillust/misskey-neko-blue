/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import classWorkerURL from '@ffmpeg/ffmpeg/worker?worker&url';

/** Single-threaded core: same-origin assets, no CDN, SharedArrayBuffer or COOP/COEP. */
export function createVideoFFmpeg() {
	const ffmpeg = new FFmpeg();
	return {
		ffmpeg,
		load: () => ffmpeg.load({
			classWorkerURL,
			coreURL: new URL(coreURL, window.location.href).href,
			wasmURL: new URL(wasmURL, window.location.href).href,
		}),
	};
}
