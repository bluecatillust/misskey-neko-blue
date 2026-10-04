/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { ReactionService } from '@/core/ReactionService.js';
import type { NoteReactionsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['account'],

	requireCredential: true,
	secure: true,

	description: 'Get the current user\'s active reaction counts grouped by reaction.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			total: {
				type: 'integer',
				optional: false, nullable: false,
			},
			reactions: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						reaction: {
							type: 'string',
							optional: false, nullable: false,
						},
						count: {
							type: 'integer',
							optional: false, nullable: false,
						},
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		private reactionService: ReactionService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			const rows = await this.noteReactionsRepository.createQueryBuilder('reaction')
				.select('reaction.reaction', 'reaction')
				.addSelect('COUNT(*)', 'count')
				.where('reaction.userId = :userId', { userId: me.id })
				.groupBy('reaction.reaction')
				.getRawMany<{ reaction: string; count: string }>();

			const reactionCounts = new Map<string, number>();
			let total = 0;

			for (const row of rows) {
				const reaction = this.reactionService.convertLegacyReaction(row.reaction);
				const count = Number(row.count);
				total += count;
				reactionCounts.set(reaction, (reactionCounts.get(reaction) ?? 0) + count);
			}

			const reactions = Array.from(reactionCounts, ([reaction, count]) => ({ reaction, count }))
				.sort((a, b) => b.count - a.count || a.reaction.localeCompare(b.reaction))
				.slice(0, 100);

			return {
				total,
				reactions,
			};
		});
	}
}
