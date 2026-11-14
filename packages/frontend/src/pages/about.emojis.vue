<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<MkButton v-if="$i && ($i.isModerator || $i.policies.canManageCustomEmojis)" primary type="routerLink" to="/custom-emojis-manager">{{ i18n.ts.manageCustomEmojis }}</MkButton>

	<section class="_gaps" :aria-label="i18n.ts._recentEmojis.title">
		<div :class="$style.recentHeader">
			<h2 :class="$style.recentTitle">{{ i18n.ts._recentEmojis.title }}</h2>
			<MkSelect v-model="recentLimit" :items="recentLimitItems" :class="$style.recentLimit">
				<template #label>{{ i18n.ts._recentEmojis.displayCount }}</template>
			</MkSelect>
		</div>
		<div v-if="recentLoading" role="status">{{ i18n.ts.loading }}</div>
		<div v-else-if="recentError" class="_gaps">
			<div role="alert">{{ i18n.ts._recentEmojis.loadFailed }}</div>
			<MkButton @click="loadRecentEmojis">{{ i18n.ts.retry }}</MkButton>
		</div>
		<div v-else-if="recentEmojis.length > 0" :class="$style.emojis">
			<XEmoji v-for="emoji in recentEmojis" :key="emoji.name" :emoji="emoji"/>
		</div>
		<div v-else>{{ i18n.ts.nothing }}</div>
	</section>

	<div class="query">
		<MkInput v-model="q" class="" :placeholder="i18n.ts.search" autocapitalize="off">
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
	</div>

	<MkFoldableSection v-if="searchEmojis">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<div :class="$style.emojis">
			<XEmoji v-for="emoji in searchEmojis" :key="emoji.name" :emoji="emoji"/>
		</div>
	</MkFoldableSection>

	<MkFoldableSection v-for="category in customEmojiCategories" v-once :key="category ?? '___root___'" :expanded="false">
		<template #header>{{ category || i18n.ts.other }}</template>
		<div :class="$style.emojis">
			<XEmoji v-for="emoji in customEmojis.filter(e => e.category === category)" :key="emoji.name" :emoji="emoji"/>
		</div>
	</MkFoldableSection>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, watch, ref } from 'vue';
import * as Misskey from 'misskey-js';
import XEmoji from './emojis.emoji.vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { customEmojis, customEmojiCategories } from '@/custom-emojis.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const recentLimit = ref(30);
const recentLimitItems = computed(() => [10, 30, 50, 100, 200].map(count => ({
	value: count,
	label: i18n.tsx._recentEmojis.count({ count }),
})));
const recentEmojiList = ref<Misskey.entities.EmojiSimple[]>([]);
const recentEmojis = computed(() => recentEmojiList.value.slice(0, recentLimit.value));
const recentLoading = ref(true);
const recentError = ref(false);

async function loadRecentEmojis() {
	recentLoading.value = true;
	recentError.value = false;
	try {
		// Fetch once; changing the display count does not require another request.
		const { emojis } = await misskeyApi('emojis', { sort: 'recent', limit: 200 });
		recentEmojiList.value = emojis;
	} catch {
		recentError.value = true;
	} finally {
		recentLoading.value = false;
	}
}

onMounted(loadRecentEmojis);

const q = ref('');
const searchEmojis = ref<Misskey.entities.EmojiSimple[] | null>(null);

function search() {
	if (q.value === '' || q.value == null) {
		searchEmojis.value = null;
		return;
	}

	const queryarry = q.value.match(/\:([a-z0-9_]*)\:/g);

	if (queryarry) {
		searchEmojis.value = customEmojis.value.filter(emoji =>
			queryarry.includes(`:${emoji.name}:`),
		);
	} else {
		searchEmojis.value = customEmojis.value.filter(emoji => emoji.name.includes(q.value) || emoji.aliases.includes(q.value));
	}
}

watch(q, () => {
	search();
});
</script>

<style lang="scss" module>
.recentHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
}

.recentTitle {
	margin: 0;
	font-size: 1em;
}

.recentLimit {
	width: 160px;
	max-width: 100%;
}

.emojis {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	grid-gap: 12px;
}
</style>
