import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { layout: 'blank' },
    },
    {
      path: '/',
      name: 'overview',
      component: () => import('@/views/Overview.vue'),
      meta: { layout: 'dashboard', title: 'Overview' },
    },
    {
      path: '/orders',
      name: 'orders',
      component: () => import('@/views/Orders.vue'),
      meta: { layout: 'dashboard', title: 'Orders' },
    },
    {
      path: '/products',
      name: 'products',
      component: () => import('@/views/Products.vue'),
      meta: { layout: 'dashboard', title: 'Products' },
    },
    {
      path: '/games',
      name: 'games',
      component: () => import('@/views/Games.vue'),
      meta: { layout: 'dashboard', title: 'Games' },
    },
    {
      path: '/profit-settings',
      name: 'profit-settings',
      component: () => import('@/views/ProfitSettings.vue'),
      meta: { layout: 'dashboard', title: 'Profit Settings' },
    },
    {
      path: '/analytics',
      name: 'analytics',
      component: () => import('@/views/Analytics.vue'),
      meta: { layout: 'dashboard', title: 'Analytics' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { layout: 'dashboard', title: 'Settings' },
    },
    {
      path: '/funding-history',
      name: 'funding-history',
      component: () => import('@/views/FundingHistory.vue'),
      meta: { layout: 'dashboard', title: 'Funding History' },
    },
    {
      path: '/webhooks',
      name: 'webhooks',
      component: () => import('@/views/Webhooks.vue'),
      meta: { layout: 'dashboard', title: 'Webhooks' },
    },
    {
      path: '/player-lookup',
      name: 'player-lookup',
      component: () => import('@/views/PlayerLookup.vue'),
      meta: { layout: 'dashboard', title: 'Player Lookup' },
    },
    {
      path: '/direct-order',
      name: 'direct-order',
      component: () => import('@/views/DirectOrder.vue'),
      meta: { layout: 'dashboard', title: 'Direct Order' },
    },
    {
      path: '/announcements',
      name: 'announcements',
      component: () => import('@/views/Announcements.vue'),
      meta: { layout: 'dashboard', title: 'Announcements' },
    },
    {
      path: '/promos',
      name: 'promos',
      component: () => import('@/views/PromoCodes.vue'),
      meta: { layout: 'dashboard', title: 'Promo Codes & Discounts' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

// Simple auth guard
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('admin_token')
  if (to.name !== 'login' && !token) {
    next({ name: 'login' })
  } else if (to.name === 'login' && token) {
    next({ name: 'overview' })
  } else {
    next()
  }
})

export default router
