<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  open: boolean
  expanded: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// Navigation items
interface NavItem {
  label: string
  icon: string
  route?: string
  children?: { label: string; route: string }[]
  badge?: string | number
}

const navItems: NavItem[] = [
  {
    label: 'Overview',
    icon: 'overview',
    route: '/',
  },
  {
    label: 'Orders',
    icon: 'orders',
    route: '/orders',
  },
  {
    label: 'Products',
    icon: 'products',
    route: '/products',
  },
  {
    label: 'Games',
    icon: 'games',
    route: '/games',
  },    {
      label: 'Profit Settings',
      icon: 'profit',
      route: '/profit-settings',
    },
    {
      label: 'Analytics',
      icon: 'chart',
      route: '/analytics',
    },    {
      label: 'Announcements',
      icon: 'star',
      route: '/announcements',
    },
    {
      label: 'Promo Codes',
      icon: 'profit',
      route: '/promos',
    },
    {
    label: 'Operations',
    icon: 'operations',
    children: [
      { label: 'Funding History', route: '/funding-history' },
      { label: 'Player Lookup', route: '/player-lookup' },
      { label: 'Direct Order', route: '/direct-order' },
      { label: 'Webhooks', route: '/webhooks' },
    ],
  },
  {
    label: 'Settings',
    icon: 'settings',
    route: '/settings',
  },
]

const expandedMenus = ref<Set<string>>(new Set())

function toggleMenu(label: string) {
  if (expandedMenus.value.has(label)) {
    expandedMenus.value.delete(label)
  } else {
    expandedMenus.value.add(label)
  }
}

// Pre-expand the Operations menu if a child is active at page load
const operationsChildren = navItems.find(n => n.label === 'Operations')?.children || []
if (operationsChildren.some((c) => route.path === c.route)) {
  expandedMenus.value.add('Operations')
}

function isActive(routePath: string): boolean {
  return route.path === routePath
}

function isChildActive(children: { route: string }[]): boolean {
  return children.some((c) => route.path === c.route)
}

function navigateTo(path: string) {
  router.push(path)
  // Close sidebar on mobile after navigation
  if (window.innerWidth < 1024) {
    emit('close')
  }
}
</script>

<template>
  <aside
    class="fixed lg:static inset-y-0 left-0 z-40 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700/50 transition-all duration-300"
    :class="[
      open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      expanded ? 'w-[260px]' : 'w-[72px]',
    ]"
  >
    <!-- Branding -->
    <div
      class="flex items-center gap-3 h-16 px-4 border-b border-slate-200 dark:border-slate-700/50 cursor-pointer"
      @click="navigateTo('/')"
    >
      <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-primary-500/20">
        VT
      </div>
      <Transition name="fade">
        <div v-if="expanded" class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-slate-900 dark:text-white truncate">VidTopUp</span>
          <span class="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Admin Panel</span>
        </div>
      </Transition>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
      <template v-for="item in navItems" :key="item.label">
        <!-- Single item -->
        <div
          v-if="!item.children"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 group"
          :class="isActive(item.route!) ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'"
          @click="navigateTo(item.route!)"
          :title="!expanded ? item.label : undefined"
        >
          <AppIcon :name="item.icon" :size="22" :class="isActive(item.route!) ? 'scale-110 text-primary-600 dark:text-primary-400' : 'text-current'" class="flex-shrink-0" />
          <Transition name="fade">
            <span v-if="expanded" class="text-sm font-medium truncate">{{ item.label }}</span>
          </Transition>
          <Transition name="fade">
            <span
              v-if="expanded && item.badge"
              class="ml-auto badge badge-info text-[10px] px-1.5 py-0.5"
            >
              {{ item.badge }}
            </span>
          </Transition>
        </div>

        <!-- Accordion parent -->
        <div v-else>
          <div
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 group"
            :class="isChildActive(item.children) ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'"
            @click="expanded ? toggleMenu(item.label) : navigateTo(item.children[0].route)"
          >
            <AppIcon :name="item.icon" :size="22" class="flex-shrink-0" />
            <Transition name="fade">
              <span v-if="expanded" class="text-sm font-medium truncate flex-1">{{ item.label }}</span>
            </Transition>
            <Transition name="fade">
              <svg
                v-if="expanded && item.children"
                class="w-3.5 h-3.5 transition-transform duration-200"
                :class="expandedMenus.has(item.label) ? 'rotate-90' : ''"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </Transition>
          </div>

          <!-- Children (accordion) -->
          <Transition name="slide-down">
            <div v-if="expanded && expandedMenus.has(item.label)" class="ml-6 mt-1 space-y-1">
              <div
                v-for="child in item.children"
                :key="child.label"
                class="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 text-sm"
                :class="isActive(child.route) ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-400 font-medium' : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'"
                @click="navigateTo(child.route)"
              >
                <span class="w-1.5 h-1.5 rounded-full" :class="isActive(child.route) ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'" />
                {{ child.label }}
              </div>
            </div>
          </Transition>
        </div>
      </template>
    </nav>

    <!-- User footer -->
    <div class="p-4 border-t border-slate-200 dark:border-slate-700/50">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-xs font-bold">
          {{ auth.username?.[0]?.toUpperCase() || 'A' }}
        </div>
        <Transition name="fade">
          <div v-if="expanded" class="flex flex-col min-w-0">
            <span class="text-xs font-medium text-slate-900 dark:text-white truncate">{{ auth.username || 'Admin' }}</span>
            <span class="text-[10px] text-slate-400 dark:text-slate-500">Administrator</span>
          </div>
        </Transition>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.slide-down-enter-active {
  transition: all 0.2s ease-out;
  overflow: hidden;
}
.slide-down-leave-active {
  transition: all 0.15s ease-in;
  overflow: hidden;
}
.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  max-height: 0;
}
.slide-down-enter-to,
.slide-down-leave-from {
  max-height: 300px;
}
</style>
