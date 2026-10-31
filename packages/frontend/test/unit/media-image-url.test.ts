/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, reactive, ref } from 'vue';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import type { ComputedRef } from 'vue';
import source from '@/components/MkMediaImage.vue?raw';

// Exercise the component's actual URL computations, without mounting unrelated
// menu, account and image-loading dependencies. Browser playback is not mocked
// or guaranteed by these URL-selection tests.
const computations = source.match(/const isAnimatedImage = computed\([\s\S]*?(?=async function onClick)/)?.[0];
if (!computations) throw new Error('MkMediaImage URL computations not found');
const code = ts.transpileModule(computations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const createUrl = new Function('props', 'prefer', 'hide', 'computed', 'getStaticImageUrl', `${code}\nreturn url;`);

function setup(type: string, isSensitive = false, hidden = false) {
	const props = reactive({ image: { type, isSensitive, url: 'original', thumbnailUrl: 'thumbnail' }, raw: false });
	const prefer = reactive({ s: { loadRawImages: false, disableShowingAnimatedImages: false } });
	const hide = ref(hidden);
	const url = createUrl(props, prefer, hide, computed, (value: string) => `static:${value}`) as ComputedRef<string>;
	return { props, prefer, hide, url };
}

describe('MkMediaImage original-image selection', () => {
	for (const type of ['image/gif', 'image/webp']) {
		for (const sensitive of [false, true]) {
			test(`${type}, sensitive=${sensitive}: visible uses original; hidden does not`, () => {
				const { hide, url } = setup(type, sensitive, true);
				expect(url.value).toBe('thumbnail');
				hide.value = false;
				expect(url.value).toBe('original');
				hide.value = true;
				expect(url.value).toBe('thumbnail');
			});
		}
	}

	test('sensitive APNG retains reveal-only original behavior', () => {
		const { hide, url } = setup('image/apng', true, true);
		expect(url.value).toBe('thumbnail');
		hide.value = false;
		expect(url.value).toBe('original');
	});

	test.each(['image/apng', 'image/png', 'image/jpeg'])('ordinary %s retains the thumbnail path', type => {
		expect(setup(type).url.value).toBe('thumbnail');
	});

	test.each(['image/gif', 'image/webp', 'image/apng'])('animation-disable setting still wins for %s', type => {
		const { prefer, url } = setup(type, true);
		prefer.s.disableShowingAnimatedImages = true;
		expect(url.value).toBe('static:original');
	});

	test.each(['raw', 'loadRawImages'])('explicit %s retains its existing priority', mode => {
		const { props, prefer, url } = setup('image/gif', true, true);
		prefer.s.disableShowingAnimatedImages = true;
		if (mode === 'raw') props.raw = true;
		else prefer.s.loadRawImages = true;
		expect(url.value).toBe('original');
	});

	test('reacts when the image MIME type changes', () => {
		const { props, url } = setup('image/jpeg');
		expect(url.value).toBe('thumbnail');
		props.image.type = 'image/webp';
		expect(url.value).toBe('original');
	});
});
