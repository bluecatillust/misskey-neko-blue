/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type CompressionLevel = 0 | 1 | 2 | 3;
export type ForcedImageCompressionLevel = 1 | 2 | 3;

export const FORCED_IMAGE_COMPRESSION_MIN_BYTES = 500 * 1024;
export const DEFAULT_FORCED_IMAGE_COMPRESSION_LEVEL: ForcedImageCompressionLevel = 2;
export const FORCED_IMAGE_COMPRESSION_MIME_TYPES = new Set([
	'image/png',
	'image/jpeg',
]);

export function normalizeDefaultImageCompressionLevel(level: number | null | undefined): ForcedImageCompressionLevel {
	if (level === 1 || level === 2 || level === 3) {
		return level;
	}
	return DEFAULT_FORCED_IMAGE_COMPRESSION_LEVEL;
}

export function isForcedImageCompressionTarget(file: Pick<Blob, 'size' | 'type'>, isAnimatedImage = false): boolean {
	return !isAnimatedImage
		&& FORCED_IMAGE_COMPRESSION_MIME_TYPES.has(file.type)
		&& file.size >= FORCED_IMAGE_COMPRESSION_MIN_BYTES;
}

export function resolveImageCompressionLevel(
	level: number | null | undefined,
	file: Pick<Blob, 'size' | 'type'>,
	isAnimatedImage = false,
	fallbackLevel: number | null | undefined = DEFAULT_FORCED_IMAGE_COMPRESSION_LEVEL,
): CompressionLevel {
	if (isForcedImageCompressionTarget(file, isAnimatedImage)) {
		if (level === 1 || level === 2 || level === 3) {
			return level;
		}
		return normalizeDefaultImageCompressionLevel(fallbackLevel);
	}

	if (level === 0 || level === 1 || level === 2 || level === 3) {
		return level;
	}

	return normalizeDefaultImageCompressionLevel(fallbackLevel);
}
