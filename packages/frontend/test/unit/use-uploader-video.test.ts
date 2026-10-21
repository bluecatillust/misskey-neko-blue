/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useUploader } from '@/composables/use-uploader.js';

const state = vi.hoisted(() => ({ convert: vi.fn(), upload: vi.fn(), alert: vi.fn(), confirm: vi.fn() }));
vi.mock('@/utility/compatible-video.js', async importOriginal => ({ ...await importOriginal<any>(), convertCompatibleVideo: state.convert }));
vi.mock('@/utility/drive.js', () => ({ uploadFile: state.upload, UploadAbortedError: class extends Error {} }));
vi.mock('@/os.js', () => ({ alert: state.alert, confirm: state.confirm }));
vi.mock('@/i.js', () => ({ ensureSignin: () => ({ policies: { maxFileSizeMb: 50, watermarkAvailable: false } }) }));
vi.mock('@/instance.js', () => ({ instance: { maxFileSize: 50 * 1024 * 1024 } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { keepOriginalFilename: true, defaultVideoCompressionLevel: 1, defaultImageCompressionLevel: 0 } } }));
vi.mock('@/utility/lightbox.js', () => ({ isPreviewable: () => false, getType: () => 'video' }));
vi.mock('@/i18n.js', () => ({ i18n: { ts: {
	_uploader: { videoFormat: 'format', videoCompatible: 'compatible', videoLegacy: 'legacy', videoLegacyWarning: 'warning', videoConversionFailed: 'failed', videoTooLarge: 'large', videoHdrUnsupported: 'hdr', videoCanceled: 'canceled' },
	rename: 'rename', sensitive: 'sensitive', describeFile: 'caption', compress: 'compress', none: 'none', low: 'low', medium: 'medium', high: 'high', upload: 'upload', remove: 'remove', retry: 'retry',
} } }));

const apps: ReturnType<typeof createApp>[] = [];
function setupUploader() {
	let uploader!: ReturnType<typeof useUploader>;
	const app = createApp(defineComponent({ setup() { uploader = useUploader(); return () => h('div'); } }));
	app.mount(document.createElement('div')); apps.push(app);
	return uploader;
}
async function settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }
const source = () => new File(['original'], 'clip.mov', { type: 'video/quicktime' });
const converted = () => new Blob(['converted'], { type: 'video/mp4' });
beforeEach(() => {
	vi.clearAllMocks();
	state.convert.mockResolvedValue(converted());
	state.upload.mockReturnValue({ filePromise: Promise.resolve({ id: 'uploaded', type: 'video/mp4' }), abort: vi.fn() });
	state.confirm.mockResolvedValue({ canceled: false });
});
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); });

describe('video uploader integration', () => {
	test('defaults to compatible and uploads the converted blob', async () => {
		const uploader = setupUploader(); uploader.addFiles([source()]); await settle();
		expect(uploader.items.value[0].videoMode).toBe('compatible');
		await uploader.upload();
		expect(state.upload.mock.calls[0][0].type).toBe('video/mp4');
	});
	test('upload waits for conversion to finish', async () => {
		let finish!: (blob: Blob) => void;
		state.convert.mockImplementation(() => new Promise<Blob>(resolve => { finish = resolve; }));
		const uploader = setupUploader(); uploader.addFiles([source()]); await settle();
		const pending = uploader.upload(); await settle();
		expect(state.upload).not.toHaveBeenCalled();
		finish(converted()); await pending;
		expect(state.upload).toHaveBeenCalledTimes(1);
	});
	test('conversion failure never falls back to the original file', async () => {
		state.convert.mockRejectedValue(new Error('decoder unavailable'));
		const uploader = setupUploader(); uploader.addFiles([source()]); await settle();
		await expect(uploader.upload()).rejects.toThrow('failed');
		expect(state.upload).not.toHaveBeenCalled();
		expect(uploader.items.value[0].preprocessError).toBe('failed');
	});
	test('explicit legacy fallback resets compression and uploads the original', async () => {
		state.convert.mockRejectedValue(new Error('decoder unavailable'));
		const uploader = setupUploader(); const original = source(); uploader.addFiles([original]); await settle();
		const item = uploader.items.value[0];
		const menu = uploader.getMenu(item) as any[];
		await menu.find(entry => entry.text === 'format').children.find((entry: any) => entry.text === 'legacy').action();
		await uploader.upload();
		expect(item.compressionLevel).toBe(0);
		expect(state.upload.mock.calls[0][0]).toBe(original);
	});
	test('canceling the legacy confirmation preserves compatibility mode', async () => {
		state.convert.mockRejectedValue(new Error('decoder unavailable'));
		state.confirm.mockResolvedValue({ canceled: true });
		const uploader = setupUploader(); uploader.addFiles([source()]); await settle();
		const item = uploader.items.value[0];
		await (uploader.getMenu(item) as any[]).find(entry => entry.text === 'format').children.find((entry: any) => entry.text === 'legacy').action();
		expect(item.videoMode).toBe('compatible');
		expect(item.preprocessError).toBe('failed');
	});
	test('serializes video conversions and cancels queued work', async () => {
		let finish!: (blob: Blob) => void;
		state.convert.mockImplementation(() => new Promise<Blob>(resolve => { finish = resolve; }));
		const uploader = setupUploader(); uploader.addFiles([source(), source()]); await settle();
		expect(state.convert).toHaveBeenCalledTimes(1);
		uploader.items.value[1].abortPreprocess!();
		finish(converted()); await settle();
		expect(state.convert).toHaveBeenCalledTimes(1);
		expect(uploader.items.value[1].preprocessError).toBe('canceled');
	});
	test('warns before closing while converting', async () => {
		state.convert.mockImplementation(() => new Promise(() => {}));
		const uploader = setupUploader(); uploader.addFiles([source()]); await settle();
		const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
	});
	test('does not label images as compatible videos', async () => {
		const uploader = setupUploader(); uploader.addFiles([new File(['image'], 'photo.png', { type: 'image/png' })]); await settle();
		expect(uploader.items.value[0].videoMode).toBeUndefined();
		expect(state.convert).not.toHaveBeenCalled();
	});
});
