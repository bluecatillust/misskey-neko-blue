/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import type * as misskey from 'misskey-js';
import { genAidx } from '@/misc/id/aidx.js';
import { MiNoteReaction } from '@/models/_.js';
import { api, castAsError, createAppToken, initTestDb, post, signup } from '../utils.js';

describe('i/reaction-stats', () => {
	let connection: DataSource;
	let noteReactionsRepository: Repository<MiNoteReaction>;
	let alice: misskey.entities.SignupResponse;
	let bob: misskey.entities.SignupResponse;

	beforeAll(async () => {
		alice = await signup();
		bob = await signup();
		const aliceNote = await post(alice, { text: 'alice note' });
		const aliceSecondNote = await post(alice, { text: 'alice second note' });
		const bobNote = await post(bob, { text: 'bob note' });

		connection = await initTestDb(true);
		noteReactionsRepository = connection.getRepository(MiNoteReaction);

		const reactions = [
			'like',
			':cat:',
			...Array.from({ length: 101 }, (_, index) => `:rank${String(index).padStart(3, '0')}@remote.example:`),
		];
		const reactionIdTime = Date.now();

		await noteReactionsRepository.insert([
			...reactions.map((reaction, index) => ({
				id: genAidx(reactionIdTime + index),
				userId: alice.id,
				noteId: aliceNote.id,
				reaction,
			})),
			{
				id: genAidx(reactionIdTime + reactions.length),
				userId: alice.id,
				noteId: aliceSecondNote.id,
				reaction: '👍',
			},
			{
				id: genAidx(reactionIdTime + reactions.length + 1),
				userId: bob.id,
				noteId: bobNote.id,
				reaction: '🔥',
			},
		]);
	}, 1000 * 60 * 2);

	afterAll(async () => {
		await connection.destroy();
	});

	test('requires a signed-in first-party user', async () => {
		const anonymous = await api('i/reaction-stats', {});
		assert.strictEqual(anonymous.status, 403);
		assert.strictEqual(castAsError(anonymous.body as any).error.code, 'ACCESS_DENIED');

		const appToken = await createAppToken(alice, []);
		const application = await api('i/reaction-stats', {}, { token: appToken });
		assert.strictEqual(application.status, 403);
		assert.strictEqual(castAsError(application.body as any).error.code, 'ACCESS_DENIED');
	});

	test('returns only the current user reactions, normalized and limited to the top 100', async () => {
		const aliceStats = await api('i/reaction-stats', {}, alice);
		assert.strictEqual(aliceStats.status, 200);
		assert.strictEqual(aliceStats.body.total, 104);
		assert.strictEqual(aliceStats.body.reactions.length, 100);
		assert.deepStrictEqual(aliceStats.body.reactions[0], { reaction: '👍', count: 2 });
		assert.ok(aliceStats.body.reactions.some(item => item.reaction === ':cat@.:'));
		assert.ok(!aliceStats.body.reactions.some(item => item.reaction === 'like'));
		assert.ok(!aliceStats.body.reactions.some(item => item.reaction === '🔥'));

		for (let index = 1; index < aliceStats.body.reactions.length; index++) {
			const previous = aliceStats.body.reactions[index - 1];
			const current = aliceStats.body.reactions[index];
			assert.ok(previous.count > current.count || (
				previous.count === current.count && previous.reaction.localeCompare(current.reaction) <= 0
			));
		}

		const bobStats = await api('i/reaction-stats', {}, bob);
		assert.strictEqual(bobStats.status, 200);
		assert.strictEqual(bobStats.body.total, 1);
		assert.deepStrictEqual(bobStats.body.reactions, [{ reaction: '🔥', count: 1 }]);
	});
});
