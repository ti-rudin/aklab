import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { requiresGuest: false },
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('../views/Auth.vue'),
      meta: { requiresGuest: true },
    },
    {
      path: '/zamery',
      name: 'zamery',
      component: () => import('../views/ZameryView.vue'),
      meta: { requiresAuth: true },
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
      path: '/zamery/new',
      name: 'zamery-new',
      component: () => import('../views/ZameryEditView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/zamery/:id',
      name: 'zamery-edit',
      component: () => import('../views/ZameryEditView.vue'),
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
    return { name: 'zamery' }
  }
})

export default router
