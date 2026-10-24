/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const TITLE = '画像判定結果（機械学習による参考値）';
const CLASSES = [
	['Neutral', '一般的'],
	['Drawing', 'イラスト'],
	['Hentai', '性的イラスト'],
	['Porn', 'ポルノ'],
	['Sexy', '性的表現'],
] as const;
const pending = new Set<string>();

export function canDetectDriveImage(file: Misskey.entities.DriveFile): boolean {
	return ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/tiff', 'image/bmp', 'image/x-icon'].includes(file.type);
}

export async function detectDriveImage(file: Misskey.entities.DriveFile): Promise<void> {
	if (!canDetectDriveImage(file) || pending.has(file.id)) return;
	pending.add(file.id);
	try {
		let text: string;
		const done = os.waiting({ text: '画像を判定しています…' });
		try {
			const result = await misskeyApi('drive/files/detect-image', { fileId: file.id }, undefined, AbortSignal.timeout(150_000));
			text = CLASSES.map(([name, label]) => {
				const prediction = result.predictions.find(item => item.className === name);
				if (!prediction || !Number.isFinite(prediction.probability) || prediction.probability < 0 || prediction.probability > 1) {
					throw new Error('Invalid prediction');
				}
				return `${name}(${label}) ${(prediction.probability * 100).toFixed(2)}%`;
			}).join('\n');
		} finally {
			done();
		}

		const action = await os.actions({
			type: 'info', title: TITLE, text,
			actions: [
				{ value: 'close', text: 'わかった', primary: true },
				{ value: 'share', text: '共有' },
			],
		});
		if (!action.canceled && action.result === 'share') {
			// Use the current file state, including its sensitive flag. Opening the composer does not publish a note.
			const currentFile = await misskeyApi('drive/files/show', { fileId: file.id });
			await os.post({ initialText: `${TITLE}\n\n${text}`, initialFiles: [currentFile], instant: true });
		}
	} catch (error) {
		const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
		const messages: Record<string, string> = {
			RATE_LIMIT_EXCEEDED: '画像判定は1分間に3回までです。少し待ってからお試しください。',
			UNSUPPORTED_IMAGE: 'この画像形式、またはアニメーション画像は判定できません。',
			IMAGE_TOO_LARGE: '画像判定の上限は20MiB・4,000万画素です。',
			DETECTOR_UNAVAILABLE: '画像判定サービスが設定されていません。管理者にお問い合わせください。',
			ACCESS_DENIED: '自分のドライブにある画像だけ判定できます。',
			NO_SUCH_FILE: '画像が見つかりません。削除されていないか確認してください。',
		};
		await os.alert({ type: 'error', title: '画像判定', text: messages[code] ?? '処理に失敗しました。時間をおいて再度お試しください。' });
	} finally {
		pending.delete(file.id);
	}
}
