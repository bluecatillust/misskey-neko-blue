/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class MultipleNoteReactions1790352000000 {
    name = 'MultipleNoteReactions1790352000000'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_ad0c221b25672daf2df320a817"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7751b74317122d11575bff31c" ON "note_reaction" ("userId", "noteId", "reaction") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "note_reaction" AS "older" USING "note_reaction" AS "newer" WHERE "older"."userId" = "newer"."userId" AND "older"."noteId" = "newer"."noteId" AND "older"."id" < "newer"."id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a7751b74317122d11575bff31c"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ad0c221b25672daf2df320a817" ON "note_reaction" ("userId", "noteId") `);
    }
}
