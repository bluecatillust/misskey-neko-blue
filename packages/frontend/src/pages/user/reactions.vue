<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_spacer" style="--MI_SPACER-w: 700px;">
	<div v-if="isSelf" class="_panel _margin" :class="$style.stats">
		<MkLoading v-if="fetchingStats"/>
		<MkError v-else-if="statsError" @retry="fetchStats"/>
		<template v-else-if="stats">
			<div :class="$style.statsHeader">
				<span>{{ i18n.ts.sentReactionsCount }}</span>
				<strong :class="$style.statsTotal">{{ number(stats.total) }}</strong>
			</div>
			<template v-if="stats.reactions.length > 0">
				<div :class="$style.rankingTitle">{{ i18n.ts.ranking }}</div>
				<div :class="$style.ranking">
					<div v-for="item in stats.reactions" :key="item.reaction" :class="$style.rankingItem">
						<MkReactionIcon :class="$style.rankingReaction" :reaction="item.reaction" :noStyle="true"/>
						<span :class="$style.rankingCount">{{ number(item.count) }}</span>
					</div>
				</div>
			</template>
		</template>
	</div>

	<MkPagination v-slot="{items}" :paginator="paginator">
		<div v-for="item in items" :key="item.id" :to="`/clips/${item.id}`" class="_panel _margin">
			<div :class="$style.header">
				<MkAvatar :class="$style.avatar" :user="user"/>
				<MkReactionIcon :class="$style.reaction" :reaction="item.type" :noStyle="true"/>
				<MkTime :time="item.createdAt" :class="$style.createdAt"/>
			</div>
			<MkNote :key="item.id" :note="item.note"/>
		</div>
	</MkPagination>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkPagination from '@/components/MkPagination.vue';
import MkNote from '@/components/MkNote.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { Paginator } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import number from '@/filters/number.js';

const props = defineProps<{
	user: Misskey.entities.User;
}>();

const isSelf = computed(() => $i?.id === props.user.id);
const stats = ref<Misskey.Endpoints['i/reaction-stats']['res'] | null>(null);
const fetchingStats = ref(false);
const statsError = ref(false);

async function fetchStats(): Promise<void> {
	if (!isSelf.value) return;

	fetchingStats.value = true;
	statsError.value = false;

	try {
		stats.value = await misskeyApi('i/reaction-stats');
	} catch {
		statsError.value = true;
	} finally {
		fetchingStats.value = false;
	}
}

watch(() => props.user.id, fetchStats, { immediate: true });

const paginator = markRaw(new Paginator('users/reactions', {
	limit: 20,
	computedParams: computed(() => ({
		userId: props.user.id,
	})),
}));
</script>

<style lang="scss" module>
.header {
	display: flex;
	align-items: center;
	padding: 8px 16px;
	margin-bottom: 8px;
	border-bottom: solid 2px var(--MI_THEME-divider);
}

.stats {
	padding: 20px;
}

.statsHeader {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 16px;
}

.statsTotal {
	font-size: 1.6em;
	font-variant-numeric: tabular-nums;
}

.rankingTitle {
	margin-top: 20px;
	font-weight: bold;
}

.ranking {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
	gap: 8px;
	margin-top: 8px;
}

.rankingItem {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
}

.rankingReaction {
	width: 28px;
	height: 28px;
}

.rankingCount {
	margin-left: auto;
	font-variant-numeric: tabular-nums;
}

.avatar {
	width: 24px;
	height: 24px;
	margin-right: 8px;
}

.reaction {
	width: 32px;
	height: 32px;
}

.createdAt {
	margin-left: auto;
}
</style>
