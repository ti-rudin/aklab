<template>
  <div class="documentation-page">
    <header class="doc-header">
      <h1 style="color: var(--text-primary)">Документация</h1>
      <p style="color: var(--text-muted)">Архитектура и руководство по AKLAB</p>
    </header>

    <nav class="doc-toc">
      <h3 style="color: var(--text-muted)">Содержание</h3>
      <ul>
        <li v-for="item in toc" :key="item.id">
          <a :href="'#' + item.id" style="color: var(--text-muted)" @click.prevent="scrollTo(item.id)">
            {{ item.label }}
          </a>
        </li>
      </ul>
    </nav>

    <div class="doc-content" v-html="html" @click="handleLinkClick"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { marked } from 'marked'

const router = useRouter()
const html = ref('')

const toc = [
  { id: 'overview', label: 'Обзор' },
  { id: 'architecture', label: 'Архитектура' },
  { id: 'services', label: 'Сервисы' },
  { id: 'data-flow', label: 'Поток данных' },
  { id: 'parsers', label: 'Парсеры' },
  { id: 'pipeline', label: 'Пайплайн' },
  { id: 'api', label: 'API' },
  { id: 'deploy', label: 'Деплой' },
  { id: 'sections', label: 'Разделы интерфейса' },
]

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

/** Intercept internal links in rendered markdown → use router.push */
function handleLinkClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  const href = a.getAttribute('href')
  if (href && href.startsWith('/') && !href.startsWith('//')) {
    e.preventDefault()
    router.push(href)
  }
}

onMounted(async () => {
  const res = await fetch('/docs/architecture.md')
  const md = await res.text()

  // Marked renders raw HTML tags in markdown as-is — perfect for our
  // custom div-based layout (arch-diagram, tables, parser-cards, etc.)
  marked.setOptions({ breaks: false, gfm: true })
  html.value = marked.parse(md) as string
})
</script>

<style scoped>
.documentation-page {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.doc-header {
  text-align: center;
  margin-bottom: 2rem;
}

.doc-header h1 {
  font-size: 1.75rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.doc-header p {
  font-size: 0.9rem;
}

/* TOC */
.doc-toc {
  margin-bottom: 2.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.doc-toc h3 {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.doc-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5rem;
}

.doc-toc a {
  text-decoration: none;
  font-size: 0.85rem;
}

.doc-toc a:hover {
  opacity: 0.7;
}

/* Sections — deep selectors for v-html content */
.doc-content :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.doc-content :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.doc-content :deep(p) {
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--text-secondary);
}

.doc-content :deep(code) {
  font-size: 0.8rem;
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
}

.doc-content :deep(ul) {
  font-size: 0.85rem;
  line-height: 1.7;
  padding-left: 1.25rem;
  color: var(--text-secondary);
}

/* Architecture diagram */
.doc-content :deep(.arch-diagram) {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0;
}

.doc-content :deep(.arch-layer) {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.doc-content :deep(.arch-label) {
  width: 6rem;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  text-align: right;
}

.doc-content :deep(.arch-box) {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.85rem;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.doc-content :deep(.arch-box strong) { color: var(--text-primary); }
.doc-content :deep(.arch-box span) { font-size: 0.75rem; color: var(--text-muted); margin-left: 0.5rem; }
.doc-content :deep(.arch-box.frontend) { border-left: 3px solid #3b82f6; }
.doc-content :deep(.arch-box.backend) { border-left: 3px solid #059669; }
.doc-content :deep(.arch-box.parser) { border-left: 3px solid #d97706; font-size: 0.75rem; padding: 0.35rem 0.75rem; }

.doc-content :deep(.arch-services) {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.doc-content :deep(.arch-arrow) {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.15rem 0;
}

/* Dependency tree */
.doc-content :deep(.dep-tree) {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.doc-content :deep(.dep-item) { padding: 0.35rem 0; }
.doc-content :deep(.dep-child) { padding-left: 1.5rem; }
.doc-content :deep(.dep-child2) { padding-left: 3rem; font-size: 0.8rem; color: var(--text-muted); }

/* Service table */
.doc-content :deep(.service-table) {
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  overflow: hidden;
}

.doc-content :deep(.service-row) {
  display: grid;
  grid-template-columns: 10rem 3.5rem 11rem 1fr;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

.doc-content :deep(.service-row:last-child) { border-bottom: none; }

.doc-content :deep(.service-row.header) {
  background: var(--bg-elevated);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.doc-content :deep(.service-row .mono),
.doc-content :deep(.api-row .mono) {
  font-family: monospace;
  font-size: 0.75rem;
}

/* Parser cards */
.doc-content :deep(.parser-cards) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.doc-content :deep(.parser-card) {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  background: var(--bg-elevated);
}

.doc-content :deep(.parser-name) {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.doc-content :deep(.parser-meta) {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.doc-content :deep(.parser-type) {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: #dbeafe;
  color: #3b82f6;
}

.doc-content :deep(.parser-status) {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
}

.doc-content :deep(.parser-status.active) { background: #d1fae5; color: #059669; }
.doc-content :deep(.parser-status.inactive) { background: #fee2e2; color: #dc2626; }

.doc-content :deep(.parser-desc) {
  font-size: 0.78rem;
  line-height: 1.4;
  color: var(--text-muted);
}

/* API table */
.doc-content :deep(.api-table) {
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  overflow: hidden;
}

.doc-content :deep(.api-row) {
  display: grid;
  grid-template-columns: 3.5rem 16rem 1fr;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
}

.doc-content :deep(.api-row:last-child) { border-bottom: none; }

.doc-content :deep(.api-row.header) {
  background: var(--bg-elevated);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
}

.doc-content :deep(.api-row .get) { color: #059669; }
.doc-content :deep(.api-row .post) { color: #3b82f6; }
.doc-content :deep(.api-row .put) { color: #d97706; }

/* Deploy steps */
.doc-content :deep(.deploy-steps) {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-content :deep(.deploy-step) {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.doc-content :deep(.deploy-num) {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 0.1rem;
}

.doc-content :deep(.deploy-step strong) { font-size: 0.85rem; color: var(--text-primary); }
.doc-content :deep(.deploy-step p) { font-size: 0.78rem; margin-top: 0.1rem; color: var(--text-muted); }

.doc-content :deep(.build-order) {
  font-family: monospace;
  font-size: 0.8rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.375rem;
  background: var(--bg-elevated);
  line-height: 1.8;
  color: var(--text-secondary);
}

/* Flow steps */
.doc-content :deep(.flow-steps) {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.doc-content :deep(.flow-step) {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.doc-content :deep(.flow-num) {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-top: 0.15rem;
}

.doc-content :deep(.flow-step h3) {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.doc-content :deep(.flow-step p) {
  font-size: 0.85rem;
  line-height: 1.5;
}

/* Section links */
.doc-content :deep(.doc-links) {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.doc-content :deep(.doc-links a) {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-subtle);
  border-radius: 0.5rem;
  text-decoration: none;
  transition: all 0.15s;
  background: var(--bg-elevated);
}

.doc-content :deep(.doc-links a:hover) {
  border-color: var(--text-muted);
}

.doc-content :deep(.doc-links strong) {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.doc-content :deep(.doc-links .text-muted) {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.doc-content :deep(.link-icon) {
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* Text helpers */
.doc-content :deep(.text-muted) { color: var(--text-muted); }

/* Responsive */
@media (max-width: 640px) {
  .doc-content :deep(.parser-cards) {
    grid-template-columns: 1fr;
  }
  .doc-content :deep(.service-row) {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
  .doc-content :deep(.service-row.header) { display: none; }
  .doc-content :deep(.api-row) {
    grid-template-columns: 3rem 1fr;
  }
  .doc-content :deep(.api-row span:last-child) {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
}
</style>
