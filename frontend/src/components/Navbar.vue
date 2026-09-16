<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { preferredCurrency, toggleCurrency } from '@/composables/useCurrency'
import gsap from 'gsap'
import { ANIM_TIMING } from '@/composables/useAnimationTiming'

const props = defineProps<{
  isDark: boolean
  transitioning?: boolean
}>()

const emit = defineEmits<{
  'toggle-dark': []
}>()

const router = useRouter()
const route = useRoute()
const mobileMenuOpen = ref(false)
const scrolled = ref(false)

// ─── Logo ref for entrance + nav animations ───
const logoRef = ref<HTMLElement | null>(null)
const logoImgRef = ref<HTMLElement | null>(null)

// ─── Animate logo: entrance on mount, pulse on every navigation ───
function animateLogoEntrance() {
  const el = logoRef.value
  if (!el || !(el instanceof Element)) return
  gsap.fromTo(
    el,
    { opacity: 0, y: -10, scale: 0.85, rotation: -5 },
    { opacity: 1, y: 0, scale: 1, rotation: 0, duration: ANIM_TIMING.enterDuration, ease: 'back.out(1.7)', delay: 0.15 }
  )
}

function animateLogoNavPulse() {
  if (!logoImgRef.value) return
  gsap.fromTo(
    logoImgRef.value,
    { scale: 1 },
    {
      scale: 1.08,
      duration: 0.2,
      ease: 'power2.out',
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        gsap.set(logoImgRef.value, { scale: 1, clearProps: 'scale' })
      },
    }
  )
}

// ─── Scroll-aware shadow ───
let scrollHandler: (() => void) | null = null

onMounted(() => {
  scrollHandler = () => {
    scrolled.value = window.scrollY > 20
  }
  window.addEventListener('scroll', scrollHandler, { passive: true })

  // Entrance animation on first load
  nextTick(() => {
    animateLogoEntrance()
  })
})

onUnmounted(() => {
  if (scrollHandler) window.removeEventListener('scroll', scrollHandler)
})

// ─── Replay logo pulse on every route change ───
watch(
  () => route.fullPath,
  () => {
    nextTick(() => animateLogoNavPulse())
  }
)

// ─── Route active check ───
const isActive = (path: string) => route.path === path

// ─── Mobile menu animation ───
function toggleMobileMenu() {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

function closeMobile() {
  mobileMenuOpen.value = false
}

// ─── Navigate and close mobile ───
function navigateAndClose(path: string) {
  closeMobile()
  router.push(path)
}
</script>

<template>
  <header
    :class="[
      'sticky top-0 z-50 transition-all duration-300',
      scrolled
        ? 'backdrop-blur-xl bg-white/85 dark:bg-surface-950/85 border-b border-surface-200/60 dark:border-surface-800/60 shadow-lg shadow-black/5'
        : 'backdrop-blur-md bg-white/70 dark:bg-surface-950/70 border-b border-transparent'
    ]"
    style="padding-top: env(safe-area-inset-top, 0px);"
  >
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <!-- Logo -->
        <router-link to="/" class="group">
          <!-- ref lives on a real DOM element — a ref on <router-link> (a
               component) hands GSAP a Vue proxy and produces
               "Invalid property ... Missing plugin?" warnings -->
          <div ref="logoRef" class="flex items-center gap-2.5">
          <!-- Logo image with animated gradient border -->
          <div ref="logoImgRef" class="logo-ring relative w-10 h-10 transition-all duration-500 group-hover:scale-110 group-hover:rotate-[-4deg]">
            <!-- Animated conic gradient border -->
            <div class="logo-ring__gradient absolute inset-0 rounded-xl"></div>
            <!-- Inner surface (2px inset creates border gap) -->
            <div class="absolute inset-[2px] rounded-[10px] bg-white dark:bg-surface-900 flex items-center justify-center overflow-hidden shadow-lg shadow-primary-500/15 group-hover:shadow-primary-500/30 transition-shadow duration-500">
              <img
                src="/logo.png"
                alt="VidTopUp"
                class="w-full h-full object-contain"
              />
            </div>
          </div>
          <!-- Brand name with gradient -->
          <span class="text-lg font-bold font-heading bg-gradient-to-r from-surface-900 to-surface-700 dark:from-white dark:to-surface-300 bg-clip-text text-transparent group-hover:from-primary-600 group-hover:to-primary-400 transition-all duration-300">VidTopUp</span>
          </div>
        </router-link>

        <!-- Desktop Nav -->
        <nav class="hidden md:flex items-center gap-1">
          <router-link
            to="/"
            :class="[
              'px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200',
              isActive('/')
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'
            ]"
          >
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </span>
          </router-link>
          <router-link
            to="/orders"
            :class="[
              'px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200',
              isActive('/orders')
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'
            ]"
          >
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              My Orders
            </span>
          </router-link>
        </nav>

        <!-- Actions -->
        <div class="flex items-center gap-2">
          <!-- Currency Toggle -->
          <button
            @click="toggleCurrency()"
            class="px-3 py-1.5 text-xs font-bold rounded-xl border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:border-primary-300 dark:hover:border-primary-600 hover:text-primary-600 dark:hover:text-primary-400 transition-all duration-200"
            :title="preferredCurrency === 'USD' ? 'Switch to KHR' : 'Switch to USD'"
          >
            {{ preferredCurrency === 'USD' ? '៛ KHR' : '$ USD' }}
          </button>

          <!-- Dark Mode Toggle -->
          <button
            @click="emit('toggle-dark')"
            :disabled="transitioning"
            class="relative p-2 rounded-xl text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-amber-500 dark:hover:text-amber-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-wait"
            :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <!-- Sun icon (shown in dark mode, click to go light) -->
            <svg
              v-if="isDark"
              class="w-5 h-5 transition-all duration-500"
              :class="transitioning ? 'rotate-90 scale-0' : 'hover:rotate-45'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <!-- Moon icon (shown in light mode, click to go dark) -->
            <svg
              v-else
              class="w-5 h-5 transition-all duration-500"
              :class="transitioning ? '-rotate-90 scale-0' : 'hover:-rotate-12'"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>

            <!-- Loading spinner during transition -->
            <svg
              v-if="transitioning"
              class="absolute inset-0 m-auto w-5 h-5 animate-spin-slow text-primary-400"
              fill="none" viewBox="0 0 24 24"
            >
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </button>

          <!-- Mobile Menu Button -->
          <button
            @click="toggleMobileMenu"
            class="md:hidden p-2 rounded-xl text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-all duration-200"
            aria-label="Toggle mobile menu"
          >
            <svg v-if="!mobileMenuOpen" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile Menu -->
      <transition
        @enter="(el, done) => { gsap.fromTo(el, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', onComplete: done }) }"
        @leave="(el, done) => { gsap.to(el, { opacity: 0, y: -10, duration: 0.15, ease: 'power2.in', onComplete: done }) }"
      >
        <div
          v-show="mobileMenuOpen"
          class="md:hidden border-t border-surface-200 dark:border-surface-800 py-3 pb-4"
        >
          <router-link
            to="/"
            @click="closeMobile"
            :class="[
              'block px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 mb-1',
              isActive('/')
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'
            ]"
          >
            <span class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </span>
          </router-link>
          <router-link
            to="/orders"
            @click="closeMobile"
            :class="[
              'block px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-200',
              isActive('/orders')
                ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-surface-100 hover:bg-surface-100 dark:hover:bg-surface-800'
            ]"
          >
            <span class="flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              My Orders
            </span>
          </router-link>
        </div>
      </transition>
    </div>
  </header>
</template>

<style scoped>
/* ═══ Animated gradient border ring ────────────────
 * Uses a ::before pseudo-element with a spinning
 * conic gradient. The inner inset mask creates the
 * 2px border gap so only the edge is visible.
 * ════════════════════════════════════════════════ */
.logo-ring {
  position: relative;
  overflow: hidden;
}

.logo-ring__gradient::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    #4d96ff,
    #2563eb,
    #8b5cf6,
    #c084fc,
    #2563eb,
    #4d96ff
  );
  animation: logo-spin 3s linear infinite;
  z-index: 0;
}

@keyframes logo-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
