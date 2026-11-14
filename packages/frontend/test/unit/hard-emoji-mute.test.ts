/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { computed, nextTick, ref } from 'vue';
import { preferState } from '../setup.unit.js';
import { prefer } from '@/preferences.js';
import { checkMuted, isHardMuted } from '@/utility/emoji-mute.js';
import MkEmoji from '@/components/global/MkEmoji.vue';
import MkCustomEmoji from '@/components/global/MkCustomEmoji.vue';
import MkReactionsViewer from '@/components/MkReactionsViewer.vue';
import MkEmojiPickerSection from '@/components/MkEmojiPicker.section.vue';
import MkEmojiPicker from '@/components/MkEmojiPicker.vue';

vi.mock('@/os.js', () => ({}));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/utility/misskey-api.js', () => ({}));
vi.mock('@/utility/emoji-palette.js', () => ({}));
vi.mock('@/custom-emojis.js', async () => {
	const { ref } = await import('vue');
	const emojis = [
		{ name: 'hidden', aliases: ['test'], category: null },
		{ name: 'visible', aliases: ['test'], category: null },
	];
	return {
		customEmojisMap: new Map(emojis.map(emoji => [emoji.name, emoji])),
		customEmojis: ref(emojis),
		customEmojiCategories: ref([]),
	};
});
vi.mock('@/store.js', async () => {
	const { ref } = await import('vue');
	return { store: { r: { recentlyUsedEmojis: ref([]) }, s: { recentlyUsedEmojis: [], additionalUnicodeEmojiIndexes: {} }, set: vi.fn() } };
});
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn() }));
vi.mock('@/utility/touch.js', () => ({ isTouchUsing: true }));
vi.mock('@/components/MkRippleEffect.vue', () => ({ default: {} }));
vi.mock('@/utility/media-proxy.js', () => ({
	getProxiedImageUrl: (url: string) => url,
	getStaticImageUrl: (url: string) => url,
}));
vi.mock('@/components/MkCustomEmojiDetailedDialog.vue', () => ({ default: {} }));
vi.mock('@/components/MkReactionsViewer.reaction.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			props: ['reaction', 'count'],
			setup: props => () => h('button', { 'data-reaction': props.reaction }, `${props.reaction} ${props.count}`),
		}),
	};
});

beforeEach(() => {
	prefer.r.hardMuteEmojis.value = false;
	prefer.r.mutingEmojis.value = [':hidden:', '😡'];
	preferState.emojiStyle = 'twemoji';
});

afterEach(() => {
	cleanup();
	prefer.r.hardMuteEmojis.value = false;
	prefer.r.mutingEmojis.value = [];
	preferState.emojiStyle = '';
});

describe('hard emoji mute matching', () => {
	test('soft mode still matches the list without hiding reactions', () => {
		expect(checkMuted(':hidden@.:').value).toBe(true);
		expect(isHardMuted(':hidden@.:')).toBe(false);
	});

	test('normalizes local aliases and keeps remote hosts distinct', () => {
		prefer.r.hardMuteEmojis.value = true;
		prefer.r.mutingEmojis.value.push(':remote@one.example:');
		for (const emoji of [':hidden:', ':hidden@.:', '😡', ':remote@one.example:']) {
			expect(isHardMuted(emoji)).toBe(true);
		}
		for (const emoji of [':hidden@one.example:', ':remote@two.example:', '😺']) {
			expect(isHardMuted(emoji)).toBe(false);
		}
	});

	test('responds to mode, list and dynamic emoji changes', () => {
		const emoji = ref(':hidden:');
		const muted = checkMuted(emoji);
		const hidden = computed(() => isHardMuted(emoji.value));
		expect(hidden.value).toBe(false);
		prefer.r.hardMuteEmojis.value = true;
		expect(hidden.value).toBe(true);
		emoji.value = '😺';
		expect(muted.value).toBe(false);
		expect(hidden.value).toBe(false);
		prefer.r.mutingEmojis.value.push('😺');
		expect(hidden.value).toBe(true);
		prefer.r.mutingEmojis.value = [];
		expect(hidden.value).toBe(false);
	});
});

describe('emoji rendering', () => {
	test.each([
		{ name: 'visible', url: '/wide.png' },
		{ name: 'hidden' },
		{ name: 'absent', fallbackToImage: true },
		{ name: 'absent' },
	])('custom emoji forwards parent sizing attributes: %j', props => {
		const view = render(MkCustomEmoji, {
			props,
			attrs: { class: 'picker-emoji-size', style: { maxWidth: '70px', height: '24px' }, 'data-sizing': 'parent' },
		});
		const element = view.container.firstElementChild as HTMLElement;
		expect(element.classList.contains('picker-emoji-size')).toBe(true);
		expect(element.style.maxWidth).toBe('70px');
		expect(element.style.height).toBe('24px');
		expect(element.dataset.sizing).toBe('parent');
	});

	test.each(['twemoji', 'fluentEmoji', 'native'])('Unicode emoji forwards parent sizing attributes in %s mode', style => {
		preferState.emojiStyle = style;
		const view = render(MkEmoji, {
			props: { emoji: '😺' },
			attrs: { class: 'picker-emoji-size', style: { maxWidth: '70px' } },
		});
		const element = view.container.firstElementChild as HTMLElement;
		expect(element.classList.contains('picker-emoji-size')).toBe(true);
		expect(element.style.maxWidth).toBe('70px');
	});

	test('custom emoji switches from placeholder to no element, then back', async () => {
		const view = render(MkCustomEmoji, { props: { name: 'hidden', fallbackToImage: true } });
		expect(view.container.querySelector('img')?.getAttribute('src')).toMatch(/\/unknown\.png$/);
		prefer.r.hardMuteEmojis.value = true;
		await nextTick();
		expect(view.container.children).toHaveLength(0);
		expect(view.container.textContent).toBe('');
		prefer.r.hardMuteEmojis.value = false;
		await nextTick();
		expect(view.container.querySelector('img')?.getAttribute('src')).toMatch(/\/unknown\.png$/);
	});

	test('restores parent sizing and the wide-picker load handler after hiding', async () => {
		const onLoad = vi.fn();
		const view = render(MkCustomEmoji, {
			props: { name: 'hidden', url: '/wide.png' },
			attrs: { class: 'picker-emoji-size', style: { maxWidth: '70px' }, onLoad },
		});
		prefer.r.hardMuteEmojis.value = true;
		await nextTick();
		expect(view.container.children).toHaveLength(0);
		prefer.r.hardMuteEmojis.value = false;
		await nextTick();
		const placeholder = view.container.querySelector('img')!;
		expect(placeholder.classList.contains('picker-emoji-size')).toBe(true);
		expect(placeholder.style.maxWidth).toBe('70px');
		prefer.r.mutingEmojis.value = [];
		await nextTick();
		const image = view.container.querySelector('img')!;
		expect(image.classList.contains('picker-emoji-size')).toBe(true);
		expect(image.style.maxWidth).toBe('70px');
		await fireEvent.load(image);
		expect(onLoad).toHaveBeenCalledOnce();
	});

	test.each(['twemoji', 'fluentEmoji', 'native'])('hides Unicode emoji in %s mode', async style => {
		preferState.emojiStyle = style;
		const view = render(MkEmoji, { props: { emoji: '😡' } });
		expect(view.container.querySelector('img')).not.toBeNull();
		prefer.r.hardMuteEmojis.value = true;
		await nextTick();
		expect(view.container.children).toHaveLength(0);
		expect(view.container.textContent).toBe('');
	});

	test('keeps the settings-list escape hatch for custom and Unicode emoji', () => {
		prefer.r.hardMuteEmojis.value = true;
		const custom = render(MkCustomEmoji, { props: { name: 'hidden', url: '/hidden.png', ignoreMuted: true } });
		const unicode = render(MkEmoji, { props: { emoji: '😡', ignoreMuted: true } });
		expect(custom.container.querySelector('img')?.getAttribute('src')).toBe('/hidden.png');
		expect(unicode.container.querySelector('img')?.getAttribute('src')).not.toMatch(/\/unknown\.png$/);
	});

	test('remote emoji are hidden only for the registered host', () => {
		prefer.r.hardMuteEmojis.value = true;
		prefer.r.mutingEmojis.value = [':hidden@one.example:'];
		const hidden = render(MkCustomEmoji, { props: { name: 'hidden', host: 'one.example' } });
		const visible = render(MkCustomEmoji, { props: { name: 'hidden', host: 'two.example' } });
		expect(hidden.container.children).toHaveLength(0);
		expect(visible.container.querySelector('img')).not.toBeNull();
	});

	test('unmuting restores the original custom image without reloading', async () => {
		prefer.r.hardMuteEmojis.value = true;
		const view = render(MkCustomEmoji, { props: { name: 'hidden', url: '/hidden.png' } });
		expect(view.container.children).toHaveLength(0);
		prefer.r.mutingEmojis.value = [];
		await nextTick();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/hidden.png');
	});
});

describe('note reaction filtering', () => {
	const createViewer = (extra = {}) => render(MkReactionsViewer, {
		props: {
			noteId: 'note',
			reactions: { ':hidden@.:': 9, '😺': 2 },
			reactionEmojis: {},
			myReaction: null,
			...extra,
		},
		slots: { more: '<span data-testid="more">more</span>' },
	});

	test('filters before applying the limit and computing the more indicator', () => {
		prefer.r.hardMuteEmojis.value = true;
		const view = createViewer({ maxNumber: 1 });
		expect(view.container.querySelectorAll('button')).toHaveLength(1);
		expect(view.container.querySelector('button')?.textContent).toBe('😺 2');
		expect(view.queryByTestId('more')).toBeNull();
	});

	test('does not reinsert hidden reactions from the local multiple-reaction fields', () => {
		prefer.r.hardMuteEmojis.value = true;
		const view = createViewer({ myReaction: ':hidden@.:', myReactions: [':hidden@.:', '😺', '😡'] });
		expect(view.container.querySelectorAll('button')).toHaveLength(1);
		expect(view.container.textContent).toBe('😺 2');
	});

	test('does not reinsert a hidden legacy myReaction', () => {
		prefer.r.hardMuteEmojis.value = true;
		const view = createViewer({ myReaction: ':hidden@.:' });
		expect(view.container.querySelector('[data-reaction=":hidden@.:"]')).toBeNull();
	});

	test('reacts to mode/list changes and streamed reaction updates', async () => {
		const view = createViewer();
		expect(view.container.querySelectorAll('button')).toHaveLength(2);
		prefer.r.hardMuteEmojis.value = true;
		await nextTick();
		expect(view.container.querySelectorAll('button')).toHaveLength(1);
		await view.rerender({ reactions: { ':hidden@.:': 10, '😺': 3, '😡': 1 } });
		expect(view.container.textContent).toBe('😺 3');
		prefer.r.mutingEmojis.value.push('😺');
		await nextTick();
		expect(view.container.querySelectorAll('button')).toHaveLength(0);
		expect(view.queryByTestId('more')).toBeNull();
		prefer.r.hardMuteEmojis.value = false;
		await nextTick();
		expect(view.container.querySelectorAll('button')).toHaveLength(3);
	});
});

test('picker sections remove the entire button and update their item count', async () => {
	prefer.r.hardMuteEmojis.value = true;
	const view = render(MkEmojiPickerSection, {
		props: { emojis: [':hidden:', '😡', '😺'], initialShown: true, hasChildSection: false },
		global: { components: { MkEmoji, MkCustomEmoji }, directives: { panel: {} } },
	});
	expect(view.container.querySelectorAll('button')).toHaveLength(1);
	expect(view.container.querySelector('header')?.textContent).toContain(':1');
	prefer.r.hardMuteEmojis.value = false;
	await nextTick();
	expect(view.container.querySelectorAll('button')).toHaveLength(3);
});

describe('picker keyboard selection', () => {
	const createPicker = () => {
		prefer.r.emojiPickerScale = ref(2);
		prefer.r.emojiPickerWidth = ref(2);
		prefer.r.emojiPickerHeight = ref(3);
		return render(MkEmojiPicker, {
			global: { components: { MkEmoji, MkCustomEmoji }, directives: { panel: {}, tooltip: {} } },
		});
	};

	test.each(['hidden', '😡'])('Enter cannot choose a hidden exact match (%s)', async query => {
		prefer.r.hardMuteEmojis.value = true;
		const view = createPicker();
		const input = view.container.querySelector('input')!;
		await fireEvent.update(input, query);
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(view.emitted().chosen).toBeUndefined();
	});

	test('Enter chooses the first visible search result', async () => {
		prefer.r.hardMuteEmojis.value = true;
		const view = createPicker();
		const input = view.container.querySelector('input')!;
		await fireEvent.update(input, 'test');
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(view.emitted().chosen).toEqual([[':visible:']]);
	});

	test('soft mode retains exact-match selection', async () => {
		const view = createPicker();
		const input = view.container.querySelector('input')!;
		await fireEvent.update(input, 'hidden');
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(view.emitted().chosen).toEqual([[':hidden:']]);
	});
});
