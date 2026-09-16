<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMeta } from '@/composables/useMeta'
import { useJsonLd } from '@/composables/useJsonLd'
import { useAnalytics } from '@/composables/useAnalytics'
import Navbar from '@/components/Navbar.vue'
import Footer from '@/components/Footer.vue'
import ToastContainer from '@/components/ToastContainer.vue'
import InstallPrompt from '@/components/InstallPrompt.vue'
import AppUpdateBanner from '@/components/AppUpdateBanner.vue'
import AnnouncementBanner from '@/components/AnnouncementBanner.vue'
import { usePushNotifications } from '@/composables/usePushNotifications'
import gsap from 'gsap'

const router = useRouter()
const isDark = ref(false)
const transitioning = ref(false)
const overlayRef = ref<HTMLElement | null>(null)
// ─── Route order for directional slide hints ───────────────
// Controls which direction pages slide (forward = left, back = right).
// Must stay in sync with the router's named routes.
const ROUTE_ORDER = [
  'home',
  'game-detail',
  'checkout',
  'payment',
  'payment-success',
  'order-status',
  'order-history',
] as const

// Track navigation direction for directional slide hints
// 'forward' = slide left (exit) / right (enter) — default
// 'back' = slide right (exit) / left (enter)
const navDirection = ref<'forward' | 'back'>('forward')

// ─── Map transition types to CSS custom property values ─────
const TRANSITION_PROPS: Record<string, {
  enterTransform: (dir?: number) => string
  enterDuration: string
  enterEase: string
  leaveTransform: (dir?: number) => string
  leaveDuration: string
  leaveEase: string
}> = {
  slide: {
    enterTransform: (dir = 1) => `translateX(${dir * 60}px) scale(0.97)`,
    enterDuration: '400ms',
    enterEase: 'cubic-bezier(0.33, 1, 0.68, 1)',
    leaveTransform: (dir = 1) => `translateX(${dir * -30}px) scale(0.96)`,
    leaveDuration: '250ms',
    leaveEase: 'ease-in',
  },
  fade: {
    enterTransform: () => 'none',
    enterDuration: '300ms',
    enterEase: 'ease-in-out',
    leaveTransform: () => 'none',
    leaveDuration: '200ms',
    leaveEase: 'ease-in-out',
  },
  scale: {
    enterTransform: () => 'scale(0.92)',
    enterDuration: '350ms',
    enterEase: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // spring-like
    leaveTransform: () => 'scale(1.08)',
    leaveDuration: '200ms',
    leaveEase: 'ease-in',
  },
  'slide-up': {
    enterTransform: () => 'translateY(40px)',
    enterDuration: '350ms',
    enterEase: 'cubic-bezier(0.33, 1, 0.68, 1)',
    leaveTransform: () => 'translateY(-20px)',
    leaveDuration: '200ms',
    leaveEase: 'ease-in',
  },
}

router.beforeEach((to, from) => {
  // Detect navigation direction — only when BOTH routes are known
  let dir = 1
  if (from?.name && to?.name) {
    const fromIdx = ROUTE_ORDER.indexOf(from.name as typeof ROUTE_ORDER[number])
    const toIdx = ROUTE_ORDER.indexOf(to.name as typeof ROUTE_ORDER[number])
    if (fromIdx !== -1 && toIdx !== -1) {
      navDirection.value = toIdx > fromIdx ? 'forward' : 'back'
    }
    dir = navDirection.value === 'forward' ? 1 : -1
  }
  document.documentElement.style.setProperty('--page-dir', String(dir))

  // ── Read route meta transition types ──
  // Leave transition uses the FROM route's meta (the page leaving)
  // Enter transition uses the TO route's meta (the page arriving)
  const leaveType = (from?.meta?.transition as string) || 'slide'
  const enterType = (to?.meta?.transition as string) || 'slide'

  const leaveProps = TRANSITION_PROPS[leaveType] || TRANSITION_PROPS.slide
  const enterProps = TRANSITION_PROPS[enterType] || TRANSITION_PROPS.slide

  // Set CSS custom properties for the leave animation
  document.documentElement.style.setProperty('--page-leave-transform', leaveProps.leaveTransform(dir))
  document.documentElement.style.setProperty('--page-leave-duration', leaveProps.leaveDuration)
  document.documentElement.style.setProperty('--page-leave-ease', leaveProps.leaveEase)

  // Set CSS custom properties for the enter animation
  document.documentElement.style.setProperty('--page-enter-transform', enterProps.enterTransform(dir))
  document.documentElement.style.setProperty('--page-enter-duration', enterProps.enterDuration)
  document.documentElement.style.setProperty('--page-enter-ease', enterProps.enterEase)

})

function toggleDark() {
  if (transitioning.value) return
  transitioning.value = true

  const goingDark = !isDark.value
  const overlay = overlayRef.value
  if (!overlay) {
    // Fallback: toggle instantly if overlay element is missing
    isDark.value = goingDark
    document.documentElement.classList.toggle('dark', goingDark)
    localStorage.setItem('theme', goingDark ? 'dark' : 'light')
    transitioning.value = false
    return
  }

  // Set overlay colour to the TARGET theme (the one we're going TO)
  overlay.className = `theme-overlay ${goingDark ? 'theme-overlay--dark' : 'theme-overlay--light'}`

  // Temporarily add transition class to all elements for smooth individual property changes
  document.documentElement.classList.add('theme-transitioning')

  // Timeline: fade in -> toggle class -> fade out
  const tl = gsap.timeline({
    onComplete: () => {
      transitioning.value = false
      // Remove the global transition class after a short delay
      setTimeout(() => {
        document.documentElement.classList.remove('theme-transitioning')
      }, 300)
    },
  })

  tl.to(overlay, {
    opacity: 0.92,
    duration: 0.12,
    ease: 'power2.in',
    onComplete: () => {
      // Toggle while overlay is fully opaque — user sees no flash
      isDark.value = goingDark
      document.documentElement.classList.toggle('dark', goingDark)
      localStorage.setItem('theme', goingDark ? 'dark' : 'light')

      // Also update the theme-color meta tag for browser chrome
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) {
        meta.setAttribute('content', goingDark ? '#020617' : '#f8fafc')
      }
    },
  })
    .to(overlay, {
      opacity: 0,
      duration: 0.3,
      ease: 'power3.out',
    })
}

const { checkSubscription } = usePushNotifications()

// ─── Dynamic SEO meta tags ──────────────────────────────────
const { setMeta } = useMeta()
const { setJsonLd } = useJsonLd()

// ─── Self-hosted analytics ─────────────────────────────────
const analytics = useAnalytics()

router.afterEach((to) => {
  setMeta(to)
  setJsonLd(to)

  // Auto-track page views
  const gameCode = to.params.gameCode as string | undefined
  analytics.trackPageView(to.path, gameCode)
})

onMounted(() => {
  // Check existing push subscription
  checkSubscription()

  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    isDark.value = true
    document.documentElement.classList.add('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', '#020617')
  }
})
</script>

<template>
  <!-- Theme crossfade overlay — sits above everything during transitions -->
  <div ref="overlayRef" class="theme-overlay" style="opacity: 0;"></div>

  <div class="min-h-screen flex flex-col bg-white dark:bg-surface-950 text-surface-900 dark:text-surface-100 transition-colors duration-200">
    <Navbar
      :is-dark="isDark"
      :transitioning="transitioning"
      @toggle-dark="toggleDark"
    />
    <AnnouncementBanner />
    <main class="flex-1">
      <router-view v-slot="{ Component, route }">
        <transition
          mode="out-in"
          name="page"
        >
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </main>
    <Footer />
    <ToastContainer />
    <InstallPrompt />
    <AppUpdateBanner />
  </div>
</template>

<style>
/* ════════════════════════════════════════════════════════════
 *  Page Transitions (CSS Only — no GSAP dependency)
 *
 *  All transition values (transform, duration, easing) are
 *  driven by CSS custom properties set dynamically in
 *  router.beforeEach based on each route's meta.transition.
 *
 *  Available transition types (set per-route via meta):
 *    'slide'     — Horizontal slide-fade (default, directional)
 *    'fade'      — Crossfade only
 *    'scale'     — Scale + fade (spring-like enter)
 *    'slide-up'  — Vertical slide up + fade
 *
 *  Direction (--page-dir): 1 = forward, -1 = back
 * ════════════════════════════════════════════════════════════ */

/* ─── Leave: current page exits ─── */
/* Fallback chain: --page-leave-duration → --anim-leave-duration → 250ms */
.page-leave-active {
  transition: opacity var(--page-leave-duration, var(--anim-leave-duration, 250ms)) var(--page-leave-ease, var(--anim-leave-ease, ease-in)),
              transform var(--page-leave-duration, var(--anim-leave-duration, 250ms)) var(--page-leave-ease, var(--anim-leave-ease, ease-in));
}

.page-leave-to {
  opacity: 0;
  transform: var(--page-leave-transform, translateX(calc(var(--page-dir, 1) * -30px)) scale(0.96));
}

/* ─── Enter: new page arrives ─── */
/* Fallback chain: --page-enter-duration → --anim-enter-duration → 400ms */
.page-enter-active {
  transition: opacity var(--page-enter-duration, var(--anim-enter-duration, 0.4s)) var(--page-enter-ease, cubic-bezier(0.33, 1, 0.68, 1)),
              transform var(--page-enter-duration, var(--anim-enter-duration, 0.4s)) var(--page-enter-ease, cubic-bezier(0.33, 1, 0.68, 1));
}

.page-enter-from {
  opacity: 0;
  transform: var(--page-enter-transform, translateX(calc(var(--page-dir, 1) * 60px)) scale(0.97));
}

</style>
