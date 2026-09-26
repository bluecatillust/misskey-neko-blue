/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { EmojisRepository, NoteReactionsRepository, UsersRepository, MiMeta } from '@/models/_.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import type { MiRemoteUser, MiUser } from '@/models/User.js';
import { MiNote } from '@/models/Note.js';
import { IdService } from '@/core/IdService.js';
import { MiNoteReaction } from '@/models/NoteReaction.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NotificationService } from '@/core/NotificationService.js';
import PerUserReactionsChart from '@/core/chart/charts/per-user-reactions.js';
import { emojiRegex } from '@/misc/emoji-regex.js';
import { ApDeliverManagerService } from '@/core/activitypub/ApDeliverManagerService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { bindThis } from '@/decorators.js';
import { UtilityService } from '@/core/UtilityService.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { RoleService } from '@/core/RoleService.js';
import { FeaturedService } from '@/core/FeaturedService.js';
import { trackPromise } from '@/misc/promise-tracker.js';
import { isQuote, isRenote } from '@/misc/is-renote.js';
import { ReactionsBufferingService } from '@/core/ReactionsBufferingService.js';
import { PER_NOTE_REACTION_USER_PAIR_CACHE_MAX } from '@/const.js';

const FALLBACK = '\u2764';
const MAX_REACTIONS_PER_LOCAL_USER_PER_NOTE = 5;

const legacies: Record<string, string> = {
	'like': '👍',
	'love': '\u2764', // ハート、異体字セレクタを入れない
	'laugh': '😆',
	'hmm': '🤔',
	'surprise': '😮',
	'congrats': '🎉',
	'angry': '💢',
	'confused': '😥',
	'rip': '😇',
	'pudding': '🍮',
	'star': '⭐',
};

type DecodedReaction = {
	/**
	 * リアクション名 (Unicode Emoji or ':name@hostname' or ':name@.')
	 */
	reaction: string;

	/**
	 * name (カスタム絵文字の場合name, Emojiクエリに使う)
	 */
	name?: string;

	/**
	 * host (カスタム絵文字の場合host, Emojiクエリに使う)
	 */
	host?: string | null;
};

const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;
const decodeCustomEmojiRegexp = /^:([\w+-]+)(?:@([\w.-]+))?:$/;

@Injectable()
export class ReactionService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.noteReactionsRepository)
		private noteReactionsRepository: NoteReactionsRepository,

		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		private utilityService: UtilityService,
		private customEmojiService: CustomEmojiService,
		private roleService: RoleService,
		private userEntityService: UserEntityService,
		private noteEntityService: NoteEntityService,
		private userBlockingService: UserBlockingService,
		private reactionsBufferingService: ReactionsBufferingService,
		private idService: IdService,
		private featuredService: FeaturedService,
		private globalEventService: GlobalEventService,
		private apRendererService: ApRendererService,
		private apDeliverManagerService: ApDeliverManagerService,
		private notificationService: NotificationService,
		private perUserReactionsChart: PerUserReactionsChart,
	) {
	}

	@bindThis
	public async create(user: { id: MiUser['id']; host: MiUser['host']; isBot: MiUser['isBot'] }, note: MiNote, _reaction?: string | null) {
		// Check blocking
		if (note.userId !== user.id) {
			const blocked = await this.userBlockingService.checkBlocked(note.userId, user.id);
			if (blocked) {
				throw new IdentifiableError('e70412a4-7197-4726-8e74-f3e0deb92aa7');
			}
		}

		// check visibility
		if (!await this.noteEntityService.isVisibleForMe(note, user.id)) {
			throw new IdentifiableError('68e9d2d1-48bf-42c2-b90a-b20e09fd3d48', 'Note not accessible for you.');
		}

		// Check if note is Renote
		if (isRenote(note) && !isQuote(note)) {
			throw new IdentifiableError('12c35529-3c79-4327-b1cc-e2cf63a71925', 'You cannot react to Renote.');
		}

		let reaction = _reaction ?? FALLBACK;

		if (note.reactionAcceptance === 'likeOnly' || ((note.reactionAcceptance === 'likeOnlyForRemote' || note.reactionAcceptance === 'nonSensitiveOnlyForLocalLikeOnlyForRemote') && (user.host != null))) {
			reaction = '\u2764';
		} else if (_reaction != null) {
			const custom = reaction.match(isCustomEmojiRegexp);
			if (custom) {
				const reacterHost = this.utilityService.toPunyNullable(user.host);

				const name = custom[1];
				const emoji = reacterHost == null
					? (await this.customEmojiService.localEmojisCache.fetch()).get(name)
					: await this.emojisRepository.findOneBy({
						host: reacterHost,
						name,
					});

				if (emoji) {
					if (emoji.roleIdsThatCanBeUsedThisEmojiAsReaction.length === 0 || (await this.roleService.getUserRoles(user.id)).some(r => emoji.roleIdsThatCanBeUsedThisEmojiAsReaction.includes(r.id))) {
						reaction = reacterHost ? `:${name}@${reacterHost}:` : `:${name}:`;

						// センシティブ
						if ((note.reactionAcceptance === 'nonSensitiveOnly' || note.reactionAcceptance === 'nonSensitiveOnlyForLocalLikeOnlyForRemote') && emoji.isSensitive) {
							reaction = FALLBACK;
						}

						// for media silenced host, custom emoji reactions are not allowed
						if (reacterHost != null && this.utilityService.isMediaSilencedHost(this.meta.mediaSilencedHosts, reacterHost)) {
							reaction = FALLBACK;
						}
					} else {
						// リアクションとして使う権限がない
						reaction = FALLBACK;
					}
				} else {
					reaction = FALLBACK;
				}
			} else {
				reaction = this.normalize(reaction);
			}
		}

		const record: MiNoteReaction = {
			id: this.idService.gen(),
			noteId: note.id,
			userId: user.id,
			reaction,
		};
		const publishCreated = await this.prepareReactionCreatedPublisher(user, note, reaction);

		const insertReaction = async (repository: Repository<MiNoteReaction>) => {
			try {
				await repository.insert(record);
			} catch (e) {
				if (isDuplicateKeyValueError(e)) {
					// 同じリアクションが同時に追加された場合も重複として扱う。
					throw new IdentifiableError('51c42bb4-931a-456b-bff7-e5a8a70dd298');
				}
				throw e;
			}
		};

		if (user.host == null) {
			// 同じユーザーによる同じ投稿への同時操作を直列化し、5個の上限を確実に守る。
			await this.withReactionLock(user.id, note.id, async transactionalEntityManager => {
				const repository = transactionalEntityManager.getRepository(MiNoteReaction);
				const existingReactions = await repository.findBy({
					noteId: note.id,
					userId: user.id,
				});
				if (existingReactions.some(existing => existing.reaction === reaction)) {
					throw new IdentifiableError('51c42bb4-931a-456b-bff7-e5a8a70dd298');
				}
				if (existingReactions.length >= MAX_REACTIONS_PER_LOCAL_USER_PER_NOTE) {
					throw new IdentifiableError('86f9f524-7c02-46a3-9b6a-3f607d0ec1a8');
				}
				await insertReaction(repository);
				await this.updateAggregatesForCreate(user, note, reaction, transactionalEntityManager.getRepository(MiNote));
				return { value: undefined, afterCommit: publishCreated };
			});
		} else {
			const replacedReaction = await this.withReactionLock(user.id, note.id, async transactionalEntityManager => {
				const repository = transactionalEntityManager.getRepository(MiNoteReaction);
				const notesRepository = transactionalEntityManager.getRepository(MiNote);
				const existingReaction = await repository.findOne({
					where: {
						noteId: note.id,
						userId: user.id,
					},
					order: {
						id: 'DESC',
					},
				});
				if (existingReaction?.reaction === reaction) {
					throw new IdentifiableError('51c42bb4-931a-456b-bff7-e5a8a70dd298');
				}
				if (existingReaction != null) {
					await repository.delete(existingReaction.id);
					await this.updateAggregatesForDelete(user, note, existingReaction, notesRepository);
				}
				await insertReaction(repository);
				await this.updateAggregatesForCreate(user, note, reaction, notesRepository);
				return {
					value: existingReaction,
					afterCommit: () => {
						if (existingReaction != null) this.publishReactionDeleted(user, note, existingReaction);
						publishCreated();
					},
				};
			});
			if (replacedReaction != null) {
				// リモートユーザーは従来どおり、投稿ごとに1つのリアクションへ置き換える。
				await this.finishDelete(user, note, replacedReaction);
			}
			await this.finishCreate(user, note, reaction, record);
			return;
		}

		await this.finishCreate(user, note, reaction, record);
	}

	@bindThis
	private async withReactionLock<T>(userId: MiUser['id'], noteId: MiNote['id'], operation: (entityManager: EntityManager) => Promise<{ value: T; afterCommit: () => void }>): Promise<T> {
		const queryRunner = this.db.createQueryRunner();
		await queryRunner.connect();
		let locked = false;
		try {
			await queryRunner.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', [userId, noteId]);
			locked = true;
			await queryRunner.startTransaction();
			let completed: { value: T; afterCommit: () => void };
			try {
				completed = await operation(queryRunner.manager);
				await queryRunner.commitTransaction();
			} catch (error) {
				await queryRunner.rollbackTransaction();
				throw error;
			}
			completed.afterCommit();
			return completed.value;
		} finally {
			if (locked) await queryRunner.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [userId, noteId]).catch(() => undefined);
			await queryRunner.release();
		}
	}

	@bindThis
	private async prepareReactionCreatedPublisher(user: { id: MiUser['id'] }, note: MiNote, reaction: string): Promise<() => void> {
		const decodedReaction = this.decodeReaction(reaction);
		const customEmoji = decodedReaction.name == null ? null : decodedReaction.host == null
			? (await this.customEmojiService.localEmojisCache.fetch()).get(decodedReaction.name)
			: await this.emojisRepository.findOne({
				where: {
					name: decodedReaction.name,
					host: decodedReaction.host,
				},
			});

		return () => {
			this.globalEventService.publishNoteStream(note, 'reacted', {
				reaction: decodedReaction.reaction,
				emoji: customEmoji != null ? {
					name: customEmoji.host ? `${customEmoji.name}@${customEmoji.host}` : `${customEmoji.name}@.`,
					// || emoji.originalUrl してるのは後方互換性のため（publicUrlはstringなので??はだめ）
					url: customEmoji.publicUrl || customEmoji.originalUrl,
				} : null,
				userId: user.id,
			});
		};
	}

	@bindThis
	private publishReactionDeleted(user: { id: MiUser['id'] }, note: MiNote, reaction: MiNoteReaction): void {
		this.globalEventService.publishNoteStream(note, 'unreacted', {
			reaction: this.decodeReaction(reaction.reaction).reaction,
			userId: user.id,
		});
	}

	@bindThis
	private async finishCreate(user: { id: MiUser['id']; host: MiUser['host']; isBot: MiUser['isBot'] }, note: MiNote, reaction: string, record: MiNoteReaction) {
		// 30%の確率、セルフではない、3日以内に投稿されたノートの場合ハイライト用ランキング更新
		if (
			Math.random() < 0.3 &&
			note.userId !== user.id &&
			(Date.now() - this.idService.parse(note.id).date.getTime()) < 1000 * 60 * 60 * 24 * 3
		) {
			if (note.channelId != null) {
				if (note.replyId == null) {
					this.featuredService.updateInChannelNotesRanking(note.channelId, note.id, 1);
				}
			} else {
				if (note.visibility === 'public' && note.userHost == null && note.replyId == null) {
					this.featuredService.updateGlobalNotesRanking(note.id, 1);
					this.featuredService.updatePerUserNotesRanking(note.userId, note.id, 1);
				}
			}
		}

		if (this.meta.enableChartsForRemoteUser || (user.host == null)) {
			this.perUserReactionsChart.update(user, note);
		}

		// リアクションされたユーザーがローカルユーザーなら通知を作成
		if (note.userHost === null) {
			this.notificationService.createNotification(note.userId, 'reaction', {
				noteId: note.id,
				reaction: reaction,
			}, user.id);
		}

		//#region 配信
		if (this.userEntityService.isLocalUser(user) && !note.localOnly) {
			const content = this.apRendererService.addContext(await this.apRendererService.renderLike(record, note));
			const dm = this.apDeliverManagerService.createDeliverManager(user, content);
			if (note.userHost !== null) {
				const reactee = await this.usersRepository.findOneBy({ id: note.userId });
				dm.addDirectRecipe(reactee as MiRemoteUser);
			}

			if (['public', 'home', 'followers'].includes(note.visibility)) {
				dm.addFollowersRecipe();
			} else if (note.visibility === 'specified') {
				const visibleUsers = await Promise.all(note.visibleUserIds.map(id => this.usersRepository.findOneBy({ id })));
				for (const u of visibleUsers.filter(u => u && this.userEntityService.isRemoteUser(u))) {
					dm.addDirectRecipe(u as MiRemoteUser);
				}
			}

			trackPromise(dm.execute());
		}
		//#endregion
	}

	@bindThis
	private async updateAggregatesForCreate(user: { id: MiUser['id'] }, note: MiNote, reaction: string, notesRepository: Repository<MiNote>) {
		// Increment reactions count
		if (this.meta.enableReactionsBuffering) {
			await this.reactionsBufferingService.create(note.id, user.id, reaction, note.reactionAndUserPairCache);
		} else {
			const sql = `jsonb_set("reactions", '{${reaction}}', (COALESCE("reactions"->>'${reaction}', '0')::int + 1)::text::jsonb)`;
			await notesRepository.createQueryBuilder().update()
				.set({
					reactions: () => sql,
					...(note.reactionAndUserPairCache.length < PER_NOTE_REACTION_USER_PAIR_CACHE_MAX ? {
						reactionAndUserPairCache: () => `array_append("reactionAndUserPairCache", '${user.id}/${reaction}')`,
					} : {}),
				})
				.where('id = :id', { id: note.id })
				.execute();
		}
	}

	@bindThis
	public async delete(user: { id: MiUser['id']; host: MiUser['host']; isBot: MiUser['isBot']; }, note: MiNote, reaction?: string) {
		const normalizedReaction = reaction == null
			? null
			: reaction.startsWith(':')
				? this.decodeReaction(reaction).reaction
				: this.normalize(reaction);
		const exist = await this.withReactionLock(user.id, note.id, async transactionalEntityManager => {
			const repository = transactionalEntityManager.getRepository(MiNoteReaction);
			const existingReactions = await repository.find({
				where: {
					noteId: note.id,
					userId: user.id,
				},
				order: {
					id: 'DESC',
				},
			});
			const existingReaction = normalizedReaction == null
				? existingReactions[0]
				: existingReactions.find(existing => this.convertLegacyReaction(existing.reaction) === normalizedReaction);

			if (existingReaction == null) {
				throw new IdentifiableError('60527ec9-b4cb-4a88-a6bd-32d3ad26817d', 'not reacted');
			}

			const result = await repository.delete(existingReaction.id);
			if (result.affected !== 1) {
				throw new IdentifiableError('60527ec9-b4cb-4a88-a6bd-32d3ad26817d', 'not reacted');
			}
			await this.updateAggregatesForDelete(user, note, existingReaction, transactionalEntityManager.getRepository(MiNote));
			return {
				value: existingReaction,
				afterCommit: () => this.publishReactionDeleted(user, note, existingReaction),
			};
		});

		await this.finishDelete(user, note, exist);
	}

	@bindThis
	private async finishDelete(user: { id: MiUser['id']; host: MiUser['host']; isBot: MiUser['isBot']; }, note: MiNote, exist: MiNoteReaction) {
		//#region 配信
		if (this.userEntityService.isLocalUser(user) && !note.localOnly) {
			const content = this.apRendererService.addContext(this.apRendererService.renderUndo(await this.apRendererService.renderLike(exist, note), user));
			const dm = this.apDeliverManagerService.createDeliverManager(user, content);
			if (note.userHost !== null) {
				const reactee = await this.usersRepository.findOneBy({ id: note.userId });
				dm.addDirectRecipe(reactee as MiRemoteUser);
			}
			dm.addFollowersRecipe();
			trackPromise(dm.execute());
		}
		//#endregion
	}

	@bindThis
	private async updateAggregatesForDelete(user: { id: MiUser['id'] }, note: MiNote, exist: MiNoteReaction, notesRepository: Repository<MiNote>) {
		// Decrement reactions count
		if (this.meta.enableReactionsBuffering) {
			await this.reactionsBufferingService.delete(note.id, user.id, exist.reaction);
		} else {
			const sql = `jsonb_set("reactions", '{${exist.reaction}}', (COALESCE("reactions"->>'${exist.reaction}', '0')::int - 1)::text::jsonb)`;
			await notesRepository.createQueryBuilder().update()
				.set({
					reactions: () => sql,
					reactionAndUserPairCache: () => `array_remove("reactionAndUserPairCache", '${user.id}/${exist.reaction}')`,
				})
				.where('id = :id', { id: note.id })
				.execute();
		}
	}

	/**
	 * - 文字列タイプのレガシーな形式のリアクションを現在の形式に変換する
	 * - ローカルのリアクションのホストを `@.` にする（`decodeReaction()`の効果）
	 */
	@bindThis
	public convertLegacyReaction(reaction: string): string {
		reaction = this.decodeReaction(reaction).reaction;
		if (Object.keys(legacies).includes(reaction)) return legacies[reaction];
		return reaction;
	}

	// TODO: 廃止
	/**
	 * - 文字列タイプのレガシーな形式のリアクションを現在の形式に変換する
	 * - ローカルのリアクションのホストを `@.` にする（`decodeReaction()`の効果）
	 * - データベース上には存在する「0個のリアクションがついている」という情報を削除する
	 */
	@bindThis
	public convertLegacyReactions(reactions: MiNote['reactions']): MiNote['reactions'] {
		return Object.entries(reactions)
			.filter(([, count]) => {
				// `ReactionService.prototype.delete`ではリアクション削除時に、
				// `MiNote['reactions']`のエントリの値をデクリメントしているが、
				// デクリメントしているだけなのでエントリ自体は0を値として持つ形で残り続ける。
				// そのため、この処理がなければ、「0個のリアクションがついている」ということになってしまう。
				return count > 0;
			})
			.map(([reaction, count]) => {
				const key = this.convertLegacyReaction(reaction);

				return [key, count] as const;
			})
			.reduce<MiNote['reactions']>((acc, [key, count]) => {
				// unchecked indexed access
				const prevCount = acc[key] as number | undefined;

				acc[key] = (prevCount ?? 0) + count;

				return acc;
			}, {});
	}

	@bindThis
	public normalize(reaction: string | null): string {
		if (reaction == null) return FALLBACK;

		// 文字列タイプのリアクションを絵文字に変換
		if (Object.keys(legacies).includes(reaction)) return legacies[reaction];

		// Unicode絵文字
		const match = emojiRegex.exec(reaction);
		if (match) {
			// 合字を含む1つの絵文字
			const unicode = match[0];

			// 異体字セレクタ除去
			return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
		}

		return FALLBACK;
	}

	@bindThis
	public decodeReaction(str: string): DecodedReaction {
		const custom = str.match(decodeCustomEmojiRegexp);

		if (custom) {
			const name = custom[1];
			const host = custom[2] ?? null;

			return {
				reaction: `:${name}@${host ?? '.'}:`,	// ローカル分は@以降を省略するのではなく.にする
				name,
				host,
			};
		}

		return {
			reaction: str,
			name: undefined,
			host: undefined,
		};
	}
}
