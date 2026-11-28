/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	DriveService,
	FORCED_IMAGE_COMPRESSION_MAX_DIMENSION,
	FORCED_IMAGE_COMPRESSION_MIN_BYTES,
} from '@/core/DriveService.js';
import type { FileInfo } from '@/core/FileInfoService.js';
import type { MiDriveFile } from '@/models/DriveFile.js';

const tmpState = vi.hoisted(() => ({
	cleanup: vi.fn(),
	tempPath: '',
}));

vi.mock('@/misc/create-temp.js', () => ({
	createTemp: vi.fn(async () => [tmpState.tempPath, tmpState.cleanup]),
	createTempDir: vi.fn(),
}));

function makeFileInfo(overrides: Partial<FileInfo> = {}): FileInfo {
	return {
		size: FORCED_IMAGE_COMPRESSION_MIN_BYTES,
		md5: 'original-md5',
		type: { mime: 'image/png', ext: 'png' },
		width: 2400,
		height: 1800,
		orientation: 6,
		blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
		sensitive: false,
		porn: false,
		warnings: [],
		...overrides,
	};
}

describe('DriveService forced image compression', () => {
	const driveFilesRepository = {
		findOneBy: vi.fn(),
		insertOne: vi.fn(),
		update: vi.fn(),
	};
	const driveFoldersRepository = {
		findOneBy: vi.fn(),
	};
	const usersRepository = {
		findOneByOrFail: vi.fn(),
	};
	const userProfilesRepository = {
		findOneBy: vi.fn(),
	};
	const fileInfoService = {
		getFileInfo: vi.fn(),
	};
	const userEntityService = {
		isLocalUser: vi.fn(),
		isRemoteUser: vi.fn(),
	};
	const driveFileEntityService = {
		validateFileName: vi.fn(),
		calcDriveUsageOf: vi.fn(),
		pack: vi.fn(),
	};
	const idService = {
		gen: vi.fn(),
	};
	const internalStorageService = {
		saveFromPath: vi.fn(),
		saveFromBuffer: vi.fn(),
	};
	const imageProcessingService = {
		convertStaticImageToWebp: vi.fn(),
	};
	const globalEventService = {
		publishMainStream: vi.fn(),
		publishDriveStream: vi.fn(),
	};
	const roleService = {
		getUserPolicies: vi.fn(),
		isModerator: vi.fn(),
	};
	const driveChart = { update: vi.fn() };
	const perUserDriveChart = { update: vi.fn() };
	const instanceChart = { updateDrive: vi.fn() };
	const utilityService = {
		isMediaSilencedHost: vi.fn(),
	};

	let service: DriveService;
	let writeFileSpy: ReturnType<typeof vi.spyOn>;
	let generateAltsSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		tmpState.tempPath = '/tmp/forced-compressed.webp';
		writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

		driveFilesRepository.findOneBy.mockResolvedValue(null);
		driveFilesRepository.insertOne.mockImplementation(async (file: MiDriveFile) => file);
		driveFoldersRepository.findOneBy.mockResolvedValue(null);
		userProfilesRepository.findOneBy.mockResolvedValue({
			alwaysMarkNsfw: false,
			autoSensitive: false,
		});
		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo());
		userEntityService.isLocalUser.mockImplementation((u: { host: string | null }) => u.host == null);
		userEntityService.isRemoteUser.mockImplementation((u: { host: string | null }) => u.host != null);
		driveFileEntityService.validateFileName.mockReturnValue(true);
		driveFileEntityService.calcDriveUsageOf.mockResolvedValue(0);
		driveFileEntityService.pack.mockResolvedValue({});
		idService.gen.mockReturnValue('file-id-1');
		internalStorageService.saveFromPath.mockReturnValue('https://example.test/files/saved');
		internalStorageService.saveFromBuffer.mockReturnValue('https://example.test/files/alt');
		roleService.isModerator.mockResolvedValue(false);
		roleService.getUserPolicies.mockResolvedValue({
			alwaysMarkNsfw: false,
			uploadableFileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/apng'],
			maxFileSizeMb: 50,
			driveCapacityMb: 100,
		});
		utilityService.isMediaSilencedHost.mockReturnValue(false);

		service = new DriveService(
			{ videoThumbnailGenerator: null } as any,
			{
				useObjectStorage: false,
				sensitiveMediaDetection: 'none',
				mediaSilencedHosts: [],
				setSensitiveFlagAutomatically: false,
				enableChartsForFederatedInstances: false,
			} as any,
			usersRepository as any,
			userProfilesRepository as any,
			driveFilesRepository as any,
			driveFoldersRepository as any,
			fileInfoService as any,
			userEntityService as any,
			driveFileEntityService as any,
			idService as any,
			{} as any,
			internalStorageService as any,
			{} as any,
			imageProcessingService as any,
			{} as any,
			globalEventService as any,
			{} as any,
			roleService as any,
			{} as any,
			driveChart as any,
			perUserDriveChart as any,
			instanceChart as any,
			utilityService as any,
		);

		generateAltsSpy = vi.spyOn(service, 'generateAlts').mockResolvedValue({
			webpublic: null,
			thumbnail: null,
		});
	});

	test('forces WebP compression for local static PNG >= 500 KiB and cleans up temp file', async () => {
		const compressedBytes = Buffer.alloc(120 * 1024, 1);
		imageProcessingService.convertStaticImageToWebp.mockResolvedValue({
			data: compressedBytes,
			ext: 'webp',
			type: 'image/webp',
			width: 1500,
			height: 1125,
		});

		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/original.png',
			name: 'illust.png',
		});

		expect(imageProcessingService.convertStaticImageToWebp).toHaveBeenCalledWith(
			'/tmp/original.png',
			FORCED_IMAGE_COMPRESSION_MAX_DIMENSION,
			FORCED_IMAGE_COMPRESSION_MAX_DIMENSION,
		);
		expect(writeFileSpy).toHaveBeenCalledWith('/tmp/forced-compressed.webp', compressedBytes);
		expect(generateAltsSpy).toHaveBeenCalledWith('/tmp/forced-compressed.webp', 'image/webp', true);
		expect(internalStorageService.saveFromPath).toHaveBeenCalledWith(expect.any(String), '/tmp/forced-compressed.webp');
		expect(saved.type).toBe('image/webp');
		expect(saved.name).toBe('illust.png.webp');
		expect(saved.size).toBe(compressedBytes.length);
		expect(saved.md5).toBe(createHash('md5').update(compressedBytes).digest('hex'));
		expect(saved.properties).toEqual({ width: 1500, height: 1125 });
		expect(tmpState.cleanup).toHaveBeenCalledTimes(1);
	});

	test('forces WebP compression for local static JPEG >= 500 KiB', async () => {
		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo({
			type: { mime: 'image/jpeg', ext: 'jpg' },
			size: 700 * 1024,
		}));
		const compressedBytes = Buffer.alloc(200 * 1024, 2);
		imageProcessingService.convertStaticImageToWebp.mockResolvedValue({
			data: compressedBytes,
			ext: 'webp',
			type: 'image/webp',
			width: 1500,
			height: 1000,
		});

		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/photo.jpg',
			name: 'photo.jpg',
		});

		expect(saved.type).toBe('image/webp');
		expect(saved.name).toBe('photo.jpg.webp');
		expect(saved.size).toBe(compressedBytes.length);
	});

	test('applies forced compression to local moderator/admin uploads (e.g. custom emoji UI)', async () => {
		roleService.isModerator.mockResolvedValue(true);
		const compressedBytes = Buffer.alloc(90 * 1024, 3);
		imageProcessingService.convertStaticImageToWebp.mockResolvedValue({
			data: compressedBytes,
			ext: 'webp',
			type: 'image/webp',
			width: 512,
			height: 512,
		});

		const saved = await service.addFile({
			user: { id: 'admin-1', host: null },
			path: '/tmp/emoji.png',
			name: 'big_emoji.png',
		});

		expect(imageProcessingService.convertStaticImageToWebp).toHaveBeenCalledTimes(1);
		expect(saved.type).toBe('image/webp');
		expect(saved.size).toBe(compressedBytes.length);
	});

	test('keeps original file when compressed WebP is not smaller', async () => {
		const largerBytes = Buffer.alloc(FORCED_IMAGE_COMPRESSION_MIN_BYTES + 1024, 4);
		imageProcessingService.convertStaticImageToWebp.mockResolvedValue({
			data: largerBytes,
			ext: 'webp',
			type: 'image/webp',
			width: 1500,
			height: 1125,
		});

		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/original.png',
			name: 'flat.png',
		});

		expect(writeFileSpy).not.toHaveBeenCalled();
		expect(saved.type).toBe('image/png');
		expect(saved.name).toBe('flat.png');
		expect(saved.size).toBe(FORCED_IMAGE_COMPRESSION_MIN_BYTES);
		expect(saved.md5).toBe('original-md5');
	});

	test('skips forced compression for PNG/JPEG smaller than 500 KiB', async () => {
		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo({
			size: FORCED_IMAGE_COMPRESSION_MIN_BYTES - 1,
		}));

		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/small.png',
			name: 'small.png',
		});

		expect(imageProcessingService.convertStaticImageToWebp).not.toHaveBeenCalled();
		expect(saved.type).toBe('image/png');
		expect(saved.size).toBe(FORCED_IMAGE_COMPRESSION_MIN_BYTES - 1);
	});

	test('skips forced compression for animated images (image/apng and multi-page PNG)', async () => {
		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo({
			type: { mime: 'image/apng', ext: 'apng' },
			size: 900 * 1024,
		}));
		await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/anim.apng',
			name: 'anim.apng',
		});
		expect(imageProcessingService.convertStaticImageToWebp).not.toHaveBeenCalled();

		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo({
			type: { mime: 'image/png', ext: 'png' },
			size: 900 * 1024,
		}));
		imageProcessingService.convertStaticImageToWebp.mockResolvedValue(null);
		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/anim.png',
			name: 'anim.png',
		});
		expect(saved.type).toBe('image/png');
		expect(saved.size).toBe(900 * 1024);
	});

	test('skips forced compression for system uploads (user: null), remote users, and link files', async () => {
		await service.addFile({
			user: null,
			path: '/tmp/imported-emoji.png',
			name: 'imported.png',
			force: true,
		});
		await service.addFile({
			user: { id: 'remote-1', host: 'remote.example' },
			path: '/tmp/remote.png',
			name: 'remote.png',
		});
		await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/link.png',
			name: 'link.png',
			isLink: true,
			url: 'https://remote.example/link.png',
		});

		expect(imageProcessingService.convertStaticImageToWebp).not.toHaveBeenCalled();
	});

	test('rejects unallowed file types and oversized uploads before running sharp compression', async () => {
		roleService.getUserPolicies.mockResolvedValue({
			alwaysMarkNsfw: false,
			uploadableFileTypes: ['image/webp'],
			maxFileSizeMb: 50,
			driveCapacityMb: 100,
		});
		await expect(service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/original.png',
			name: 'blocked.png',
		})).rejects.toThrow('Unallowed file type: image/png');

		roleService.getUserPolicies.mockResolvedValue({
			alwaysMarkNsfw: false,
			uploadableFileTypes: ['image/png', 'image/webp'],
			maxFileSizeMb: 1,
			driveCapacityMb: 100,
		});
		fileInfoService.getFileInfo.mockResolvedValue(makeFileInfo({
			size: 2 * 1024 * 1024,
		}));
		await expect(service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/too-large.png',
			name: 'too-large.png',
		})).rejects.toThrow('Max file size exceeded.');

		expect(imageProcessingService.convertStaticImageToWebp).not.toHaveBeenCalled();
	});

	test('checks drive capacity against compressed size and falls back to original on conversion error', async () => {
		roleService.getUserPolicies.mockResolvedValue({
			alwaysMarkNsfw: false,
			uploadableFileTypes: ['image/png', 'image/webp'],
			maxFileSizeMb: 50,
			driveCapacityMb: 1,
		});
		driveFileEntityService.calcDriveUsageOf.mockResolvedValue(900 * 1024);
		fileInfoService.getFileInfo.mockResolvedValueOnce(makeFileInfo({
			size: 600 * 1024,
		}));
		imageProcessingService.convertStaticImageToWebp.mockResolvedValueOnce({
			data: Buffer.alloc(100 * 1024, 5),
			ext: 'webp',
			type: 'image/webp',
			width: 1200,
			height: 900,
		});

		const saved = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/fit-after-compress.png',
			name: 'fit.png',
		});
		expect(saved.type).toBe('image/webp');
		expect(saved.size).toBe(100 * 1024);

		driveFileEntityService.calcDriveUsageOf.mockResolvedValue(0);
		fileInfoService.getFileInfo.mockResolvedValueOnce(makeFileInfo({
			size: 600 * 1024,
		}));
		imageProcessingService.convertStaticImageToWebp.mockRejectedValueOnce(new Error('sharp error'));
		const fallback = await service.addFile({
			user: { id: 'user-1', host: null },
			path: '/tmp/corrupt.png',
			name: 'corrupt.png',
		});
		expect(fallback.type).toBe('image/png');
		expect(fallback.size).toBe(600 * 1024);
	});
});
