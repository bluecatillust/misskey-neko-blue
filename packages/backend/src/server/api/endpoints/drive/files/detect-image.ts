/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as fs from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import { sharpBmp } from '@misskey-dev/sharp-read-bmp';
import { DI } from '@/di-symbols.js';
import type { DriveFilesRepository, MiMeta } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { FileInfoService } from '@/core/FileInfoService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { DownloadService } from '@/core/DownloadService.js';
import { SensitiveMediaDetectionService } from '@/core/SensitiveMediaDetectionService.js';
import { createTemp } from '@/misc/create-temp.js';
import { ApiError } from '../../../error.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon'];
const CLASSES = ['Neutral', 'Drawing', 'Hentai', 'Porn', 'Sexy'] as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

export const meta = {
	tags: ['drive'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'read:drive',
	description: 'Analyze an owned still image and return classification scores without changing the file.',
	limit: { duration: 60_000, max: 3 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			predictions: {
				type: 'array', optional: false, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false,
					properties: {
						className: { type: 'string', enum: [...CLASSES], optional: false, nullable: false },
						probability: { type: 'number', optional: false, nullable: false },
					},
				},
			},
		},
	},
	errors: {
		noSuchFile: {
			message: 'No such file.', code: 'NO_SUCH_FILE',
			id: '36554ae5-8849-4705-a358-0ed3b9c03c08',
		},
		accessDenied: {
			message: 'Access denied.', code: 'ACCESS_DENIED',
			id: '63e716b6-c05c-4b85-adc8-466522bfc12b',
		},
		unsupportedImage: {
			message: 'Only supported still images can be analyzed.', code: 'UNSUPPORTED_IMAGE',
			id: '55316772-050d-4d60-a39e-819c5d9c79d2',
		},
		imageTooLarge: {
			message: 'The image exceeds the analysis size limit.', code: 'IMAGE_TOO_LARGE',
			id: 'c72e8cdd-7473-4bbb-9564-e366ca7eaa43',
		},
		detectorUnavailable: {
			message: 'The image detector is not configured.', code: 'DETECTOR_UNAVAILABLE',
			id: '7e47cedd-f002-4910-bc1e-9a99c315933c',
		},
		detectionFailed: {
			message: 'Image analysis failed. Please try again later.', code: 'IMAGE_DETECTION_FAILED',
			id: '7345feaa-39e1-4ba2-9c26-eb92a0f9ee81',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: { fileId: { type: 'string', format: 'misskey:id' } },
	required: ['fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,
		@Inject(DI.meta)
		private serverSettings: MiMeta,
		private fileInfoService: FileInfoService,
		private internalStorageService: InternalStorageService,
		private downloadService: DownloadService,
		private sensitiveMediaDetectionService: SensitiveMediaDetectionService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (file == null) throw new ApiError(meta.errors.noSuchFile);
			// This manual analysis endpoint is owner-only, including for moderators.
			if (file.userId !== me.id || file.userHost !== null) throw new ApiError(meta.errors.accessDenied);
			if (!IMAGE_TYPES.includes(file.type)) throw new ApiError(meta.errors.unsupportedImage);
			if (file.size > MAX_BYTES) throw new ApiError(meta.errors.imageTooLarge);
			if (!this.serverSettings.sensitiveMediaDetectionApiUrl?.trim()) throw new ApiError(meta.errors.detectorUnavailable);

			let cleanup: (() => void) | undefined;
			try {
				let path: string;
				if (file.storedInternal) {
					if (!file.accessKey) throw new ApiError(meta.errors.detectionFailed);
					path = this.internalStorageService.resolvePath(file.accessKey);
				} else {
					// Fetch the registered original URL, never a URL supplied by the client.
					[path, cleanup] = await createTemp();
					await this.downloadService.downloadUrl(file.url, path);
				}
				if ((await fs.promises.stat(path)).size > MAX_BYTES) throw new ApiError(meta.errors.imageTooLarge);

				// Recheck the actual bytes. A MIME type or filename alone is insufficient.
				const type = await this.fileInfoService.detectType(path);
				if (!IMAGE_TYPES.includes(type.mime)) throw new ApiError(meta.errors.unsupportedImage);
				const image = await sharpBmp(path, type.mime);
				const metadata = await image.metadata();
				if ((metadata.pages ?? 1) > 1) throw new ApiError(meta.errors.unsupportedImage);
				if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
					throw new ApiError(meta.errors.imageTooLarge);
				}

				// Match the preprocessing used by FileInfoService for automatic detection.
				const png = await image
					.resize(299, 299, { withoutEnlargement: false })
					.rotate()
					.flatten({ background: { r: 119, g: 119, b: 119 } })
					.png()
					.toBuffer();
				const predictions = await this.sensitiveMediaDetectionService.detectSensitive(png);
				const ordered = CLASSES.map(className => {
					const prediction = predictions?.find(item => item.className === className);
					if (!prediction || !Number.isFinite(prediction.probability) || prediction.probability < 0 || prediction.probability > 1) {
						throw new ApiError(meta.errors.detectionFailed);
					}
					return { className, probability: prediction.probability };
				});
				// Do not update isSensitive, maybeSensitive, or maybePorn.
				return { predictions: ordered };
			} catch (error) {
				if (error instanceof ApiError) throw error;
				throw new ApiError(meta.errors.detectionFailed);
			} finally {
				cleanup?.();
			}
		});
	}
}
