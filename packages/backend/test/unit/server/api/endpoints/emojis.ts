/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { IsNull } from 'typeorm';
import EmojisEndpoint from '@/server/api/endpoints/emojis.js';
import type { EmojisRepository } from '@/models/_.js';
import type { EmojiEntityService } from '@/core/entities/EmojiEntityService.js';

describe('emojis endpoint', () => {
	const find = vi.fn();
	const packSimpleMany = vi.fn();
	let endpoint: EmojisEndpoint;

	beforeEach(() => {
		find.mockReset().mockResolvedValue([]);
		packSimpleMany.mockReset().mockResolvedValue([]);
		endpoint = new EmojisEndpoint(
			{ find } as unknown as EmojisRepository,
			{ packSimpleMany } as unknown as EmojiEntityService,
		);
	});

	test('keeps the existing complete category/name listing for callers without parameters', async () => {
		await endpoint.exec({}, null, null);
		expect(find).toHaveBeenCalledWith({
			where: { host: IsNull() },
			order: { category: 'ASC', name: 'ASC' },
			take: undefined,
		});
	});

	test.each([10, 30, 50, 100, 200])('returns local emojis in registration order with limit %i', async (limit) => {
		const emojis = [{ id: 'newer', updatedAt: new Date(0) }, { id: 'older', updatedAt: new Date() }];
		find.mockResolvedValue(emojis);
		packSimpleMany.mockResolvedValue([{ name: 'newer' }, { name: 'older' }]);
		await expect(endpoint.exec({ sort: 'recent', limit }, null, null)).resolves.toEqual({
			emojis: [{ name: 'newer' }, { name: 'older' }],
		});
		expect(find).toHaveBeenCalledWith({
			where: { host: IsNull() },
			order: { id: 'DESC' },
			take: limit,
		});
		expect(packSimpleMany).toHaveBeenCalledWith(emojis);
	});

	test('defaults to 30 recent emojis', async () => {
		await endpoint.exec({ sort: 'recent' }, null, null);
		expect(find.mock.calls[0][0].take).toBe(30);
	});

	test.each([0, -1, 201, 1.5, '30', null])('rejects an invalid limit: %s', async (limit) => {
		await expect(endpoint.exec({ sort: 'recent', limit }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(find).not.toHaveBeenCalled();
	});

	test('rejects unknown sort modes', async () => {
		await expect(endpoint.exec({ sort: 'updated' }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});
});
