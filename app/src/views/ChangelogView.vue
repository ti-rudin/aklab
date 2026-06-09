<template>
  <div class="changelog-page">
    <header class="changelog-header">
      <h1 style="color: var(--text-primary)">Changelog</h1>
      <p style="color: var(--text-muted)">История изменений и обновлений AKLAB</p>
    </header>

    <div v-if="loading" class="max-w-3xl mx-auto">
      <div class="skeleton h-8 w-48 mb-6" />
      <SkeletonLoader :lines="8" height="2.5rem" />
    </div>

    <!-- Фильтр по категориям -->
    <nav v-else class="changelog-filters">
      <button
        v-for="f in filters"
        :key="f.value"
        type="button"
        :class="['filter-btn', filter === f.value ? 'active ' + f.value : '']"
        @click="filter = f.value"
      >
        {{ f.label }}
      </button>
    </nav>

    <!-- Timeline -->
    <div v-if="!loading" class="changelog-timeline">
      <article
        v-for="release in paginatedReleases"
        :key="release.version"
        class="changelog-release"
      >
        <div class="release-header">
          <h3 class="release-version" style="color: var(--text-primary)">{{ release.version }}</h3>
          <span class="release-date" style="color: var(--text-muted)">
            {{ release.date }}<template v-if="release.time">, {{ release.time }}</template>
          </span>
        </div>
        <ul class="release-items">
          <li
            v-for="item in filteredItems(release)"
            :key="item.text"
            class="release-item"
          >
            <span :class="['item-dot', item.type]">{{ typeIcon(item.type) }}</span>
            <span class="item-text" style="color: var(--text-secondary)">{{ item.text }}</span>
            <span :class="['item-badge', item.type]">{{ typeLabel(item.type) }}</span>
          </li>
        </ul>
      </article>
    </div>

    <!-- Пагинация -->
    <div v-if="hasMore" class="changelog-more">
      <button type="button" class="btn-secondary" @click="showMore">
        Показать ещё
      </button>
    </div>
    <p v-else-if="visibleReleases.length > PAGE_SIZE" class="changelog-end" style="color: var(--text-muted)">
      Все обновления загружены
    </p>
  </div>
</template>

<script setup lang="ts">
import SkeletonLoader from '@/components/SkeletonLoader.vue'
import { ref, computed, watch, onMounted } from 'vue'

type ItemType = 'new' | 'improvement' | 'fix'
type FilterValue = 'all' | 'new' | 'improvement' | 'fix'

interface ChangelogItem {
  text: string
  type: ItemType
}

interface Release {
  version: string
  date: string
  time?: string
  items: ChangelogItem[]
}

const PAGE_SIZE = 10

const filters = [
  { value: 'all' as FilterValue, label: 'Все' },
  { value: 'new' as FilterValue, label: 'Новое' },
  { value: 'improvement' as FilterValue, label: 'Улучшения' },
  { value: 'fix' as FilterValue, label: 'Исправления' },
]

const filter = ref<FilterValue>('all')
const loading = ref(true)
const displayCount = ref(PAGE_SIZE)
const releases = ref<Release[]>([])

onMounted(async () => {
  try {
    const resp = await fetch('/changelog.json')
    if (resp.ok) {
      releases.value = await resp.json()
    }
  } catch { /* fallback: empty */ }
  loading.value = false
})

watch(filter, () => {
  displayCount.value = PAGE_SIZE
})

const visibleReleases = computed(() => {
  if (filter.value === 'all') return releases.value
  return releases.value.filter((r) => r.items.some((item) => item.type === filter.value))
})

const paginatedReleases = computed(() => visibleReleases.value.slice(0, displayCount.value))
const hasMore = computed(() => displayCount.value < visibleReleases.value.length)

function showMore() {
  displayCount.value += PAGE_SIZE
}

function filteredItems(release: Release): ChangelogItem[] {
  if (filter.value === 'all') return release.items
  return release.items.filter((item) => item.type === filter.value)
}

function typeIcon(type: ItemType): string {
  const map = { new: '✦', improvement: '↑', fix: '•' }
  return map[type]
}

function typeLabel(type: ItemType): string {
  const map = { new: 'Новое', improvement: 'Улучшено', fix: 'Исправлено' }
  return map[type]
}
</script>

<style scoped>
.changelog-page {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.changelog-header {
  text-align: center;
  margin-bottom: 2rem;
}

.changelog-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.changelog-header p {
  font-size: 0.9rem;
}

.changelog-filters {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.filter-btn {
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.8rem;
  font-weight: 500;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 0.15s;
}

.filter-btn:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}

.filter-btn.active {
  color: #fff;
  border-color: transparent;
}

.filter-btn.active.all { background: #374151; }
.filter-btn.active.new { background: #059669; }
.filter-btn.active.improvement { background: #3b82f6; }
.filter-btn.active.fix { background: #d97706; }

.changelog-timeline {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.changelog-release {
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  padding: 1.25rem;
  background: var(--bg-elevated);
}

.release-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.release-version {
  font-size: 0.9rem;
  font-weight: 600;
  font-family: monospace;
}

.release-date {
  font-size: 0.75rem;
}

.release-items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.release-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.item-dot {
  flex-shrink: 0;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  margin-top: 0.15rem;
}

.item-dot.new { background: #d1fae5; color: #059669; }
.item-dot.improvement { background: #dbeafe; color: #3b82f6; }
.item-dot.fix { background: #fef3c7; color: #d97706; }

.item-text {
  flex: 1;
}

.item-badge {
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 500;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
}

.item-badge.new { background: #d1fae5; color: #059669; }
.item-badge.improvement { background: #dbeafe; color: #3b82f6; }
.item-badge.fix { background: #fef3c7; color: #d97706; }

.changelog-more {
  text-align: center;
  margin-top: 2rem;
}

.changelog-end {
  text-align: center;
  font-size: 0.75rem;
  margin-top: 2rem;
}
</style>
