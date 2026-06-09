import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      redirect: () => {
        const authStore = useAuthStore()
        return authStore.isAuthenticated ? '/properties' : '/auth'
      },
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('../views/Auth.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/properties',
      name: 'properties',
      component: () => import('../views/PropertyListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/properties/:id',
      name: 'property-detail',
      component: () => import('../views/PropertyDetailView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/sources',
      name: 'sources',
      component: () => import('../views/SourceListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/market-references',
      name: 'market-references',
      component: () => import('../views/MarketReferencesView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/changelog',
      name: 'changelog',
      component: () => import('../views/ChangelogView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
    },
  ],
})

// Guards
router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // Ждём инициализации
  if (!authStore.isInitialized) {
    await authStore.init()
  }

  // Требуется авторизация, но пользователь не авторизован
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'auth' }
  }

  // Только для гостей, но пользователь авторизован
  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return { name: 'properties' }
  }
})

export default router
