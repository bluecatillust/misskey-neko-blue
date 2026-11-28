/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useUploader } from '@/composables/use-uploader.js';
import {
	FORCED_IMAGE_COMPRESSION_MIN_BYTES,
	isForcedImageCompressionTarget,
	normalizeDefaultImageCompressionLevel,
	resolveImageCompressionLevel,
} from '@/utility/image-compression.js';

const state = vi.hoisted(() => ({
	compress: vi.fn(),
	isAnimated: vi.fn(),
	upload: vi.fn(),
	alert: vi.fn(),
	confirm: vi.fn(),
	defaultImageCompressionLevel: 0 as number,
}));

vi.mock('@misskey-dev/browser-image-resizer', () => ({ readAndCompressImage: state.compress }));
vi.mock('is-file-animated', () => ({ default: state.isAnimated }));
vi.mock('@/utility/isWebpSupported.js', () => ({ isWebpSupported: () => true }));
vi.mock('@/utility/drive.js', () => ({ uploadFile: state.upload, UploadAbortedError: class extends Error {} }));
vi.mock('@/os.js', () => ({ alert: state.alert, confirm: state.confirm }));
vi.mock('@/i.js', () => ({ ensureSignin: () => ({ policies: { maxFileSizeMb: 50, watermarkAvailable: false } }) }));
vi.mock('@/instance.js', () => ({ instance: { maxFileSize: 50 * 1024 * 1024 } }));
vi.mock('@/preferences.js', () => ({
	prefer: {
		s: {
			keepOriginalFilename: true,
			defaultVideoCompressionLevel: 2,
			get defaultImageCompressionLevel() {
				return state.defaultImageCompressionLevel;
			},
			watermarkPresets: [],
			imageFramePresets: [],
		},
	},
}));
vi.mock('@/utility/lightbox.js', () => ({ isPreviewable: () => false, getType: () => 'image' }));
vi.mock('@/i18n.js', () => ({
	i18n: {
		ts: {
			_uploader: { editImage: 'edit' },
			rename: 'rename',
			sensitive: 'sensitive',
			describeFile: 'caption',
			compress: 'compress',
			none: 'none',
			low: 'low',
			medium: 'medium',
			high: 'high',
			upload: 'upload',
			remove: 'remove',
			cropImage: 'crop',
			_imageEffector: { title: 'effector' },
			frame: 'frame',
			edit: 'edit',
			presets: 'presets',
		},
	},
}));

const apps: ReturnType<typeof createApp>[] = [];
function setupUploader() {
	let uploader!: ReturnType<typeof useUploader>;
	const app = createApp(defineComponent({
		setup() {
			uploader = useUploader();
			return () => h('div');
		},
	}));
	app.mount(document.createElement('div'));
	apps.push(app);
	return uploader;
}

async function settle() {
	for (let i = 0; i < 12; i++) {
		await Promise.resolve();
		await nextTick();
	}
}

function makeFile(size: number, name: string, type: string): File {
	return new File([new Uint8Array(size)], name, { type });
}

function getCompressMenuChildren(uploader: ReturnType<typeof useUploader>, index = 0): any[] {
	const menu = uploader.getMenu(uploader.items.value[index]) as any[];
	return menu.find(entry => entry.icon === 'ti ti-leaf')?.children ?? [];
}

beforeEach(() => {
	vi.clearAllMocks();
	state.defaultImageCompressionLevel = 0;
	state.isAnimated.mockResolvedValue(false);
	state.compress.mockResolvedValue(new Blob([new Uint8Array(100 * 1024)], { type: 'image/webp' }));
	state.upload.mockReturnValue({ filePromise: Promise.resolve({ id: 'uploaded', type: 'image/webp' }), abort: vi.fn() });
	state.confirm.mockResolvedValue({ canceled: false });
	vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 1500, close: vi.fn() })));
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
	apps.splice(0).forEach(app => app.unmount());
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('image compression policy helpers', () => {
	test('normalizes legacy 0 and invalid default levels to medium (2)', () => {
		expect(normalizeDefaultImageCompressionLevel(0)).toBe(2);
		expect(normalizeDefaultImageCompressionLevel(undefined)).toBe(2);
		expect(normalizeDefaultImageCompressionLevel(1)).toBe(1);
		expect(normalizeDefaultImageCompressionLevel(2)).toBe(2);
		expect(normalizeDefaultImageCompressionLevel(3)).toBe(3);
	});

	test('targets only static PNG and JPEG files >= 500 KiB', () => {
		expect(isForcedImageCompressionTarget({ size: FORCED_IMAGE_COMPRESSION_MIN_BYTES, type: 'image/png' }, false)).toBe(true);
		expect(isForcedImageCompressionTarget({ size: FORCED_IMAGE_COMPRESSION_MIN_BYTES, type: 'image/jpeg' }, false)).toBe(true);
		expect(isForcedImageCompressionTarget({ size: FORCED_IMAGE_COMPRESSION_MIN_BYTES - 1, type: 'image/png' }, false)).toBe(false);
		expect(isForcedImageCompressionTarget({ size: FORCED_IMAGE_COMPRESSION_MIN_BYTES, type: 'image/png' }, true)).toBe(false);
		expect(isForcedImageCompressionTarget({ size: FORCED_IMAGE_COMPRESSION_MIN_BYTES, type: 'image/webp' }, false)).toBe(false);
	});

	test('resolves forced level when level is 0 on target images and allows 0 on non-targets', () => {
		const bigPng = { size: FORCED_IMAGE_COMPRESSION_MIN_BYTES, type: 'image/png' };
		const smallPng = { size: FORCED_IMAGE_COMPRESSION_MIN_BYTES - 1, type: 'image/png' };

		expect(resolveImageCompressionLevel(0, bigPng, false, 1)).toBe(1);
		expect(resolveImageCompressionLevel(0, bigPng, false, 0)).toBe(2);
		expect(resolveImageCompressionLevel(3, bigPng, false, 1)).toBe(3);
		expect(resolveImageCompressionLevel(0, smallPng, false, 2)).toBe(0);
		expect(resolveImageCompressionLevel(0, bigPng, true, 2)).toBe(0);
	});
});

describe('image uploader forced compression integration', () => {
	test('hides "none" option and compresses static PNG >= 500 KiB even if saved default is 0', async () => {
		const uploader = setupUploader();
		uploader.addFiles([makeFile(FORCED_IMAGE_COMPRESSION_MIN_BYTES, 'large.png', 'image/png')]);
		await settle();

		const item = uploader.items.value[0];
		expect(item.compressionLevel).toBe(2);
		expect(state.compress).toHaveBeenCalledTimes(1);
		expect(getCompressMenuChildren(uploader).some(entry => entry.text === 'none')).toBe(false);

		await uploader.upload();
		expect(state.upload.mock.calls[0][0].type).toBe('image/webp');
		expect(state.upload.mock.calls[0][1].name).toBe('large.png.webp');
	});

	test('hides "none" option and compresses static JPEG >= 500 KiB', async () => {
		const uploader = setupUploader();
		uploader.addFiles([makeFile(600 * 1024, 'photo.jpg', 'image/jpeg')]);
		await settle();

		expect(state.compress).toHaveBeenCalledTimes(1);
		expect(getCompressMenuChildren(uploader).some(entry => entry.text === 'none')).toBe(false);
	});

	test('keeps original file when compressed output is not smaller than original', async () => {
		const original = makeFile(FORCED_IMAGE_COMPRESSION_MIN_BYTES, 'flat.png', 'image/png');
		state.compress.mockResolvedValue(new Blob([new Uint8Array(FORCED_IMAGE_COMPRESSION_MIN_BYTES + 1024)], { type: 'image/webp' }));

		const uploader = setupUploader();
		uploader.addFiles([original]);
		await settle();

		await uploader.upload();
		expect(state.upload.mock.calls[0][0]).toBe(original);
		expect(state.upload.mock.calls[0][1].name).toBe('flat.png');
	});

	test('allows selecting "none" for PNG < 500 KiB and WebP >= 500 KiB', async () => {
		const uploader = setupUploader();
		const smallPng = makeFile(FORCED_IMAGE_COMPRESSION_MIN_BYTES - 1, 'small.png', 'image/png');
		const largeWebp = makeFile(800 * 1024, 'large.webp', 'image/webp');
		uploader.addFiles([smallPng, largeWebp]);
		await settle();

		const smallNoneOption = getCompressMenuChildren(uploader, 0).find(entry => entry.text === 'none');
		expect(smallNoneOption).toBeDefined();
		smallNoneOption.action();
		await settle();
		expect(uploader.items.value[0].compressionLevel).toBe(0);

		const webpNoneOption = getCompressMenuChildren(uploader, 1).find(entry => entry.text === 'none');
		expect(webpNoneOption).toBeDefined();
		webpNoneOption.action();
		await settle();
		expect(uploader.items.value[1].compressionLevel).toBe(0);

		await uploader.upload();
		expect(state.upload.mock.calls[0][0]).toBe(smallPng);
		expect(state.upload.mock.calls[1][0]).toBe(largeWebp);
	});

	test('skips compression and keeps "none" available for animated PNG >= 500 KiB', async () => {
		state.isAnimated.mockResolvedValue(true);
		const apng = makeFile(700 * 1024, 'animated.png', 'image/png');

		const uploader = setupUploader();
		uploader.addFiles([apng]);
		await settle();

		expect(state.compress).not.toHaveBeenCalled();
		expect(getCompressMenuChildren(uploader).some(entry => entry.text === 'none')).toBe(true);

		await uploader.upload();
		expect(state.upload.mock.calls[0][0]).toBe(apng);
	});
});
