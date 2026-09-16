<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { getCambodiaGames, getProducts } from '@/services/api'
import { clientCache } from '@/utils/clientCache'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import type { GameCategory, CambodiaGamesResponse } from '@/types'
import gsap from 'gsap'
import { useAnalytics } from '@/composables/useAnalytics'

interface BannerSlide {
  src: string
  title: string
  subtitle: string
  cta: string
  ctaGameCode: string
}

const router = useRouter()

// ─── Simple IntersectionObserver for scroll-triggered animations ───
function observeScrollAnimation(el: HTMLElement, callback: () => void) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          callback()
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.15 }
  )
  observer.observe(el)
}
const gameStore = useGameStore()
const analytics = useAnalytics()

const featured = ref<GameCategory[]>([])
const others = ref<GameCategory[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

// ─── Refs ───
const bannerRef = ref<HTMLElement | null>(null)
const featuredRef = ref<HTMLElement | null>(null)
const allGamesRef = ref<HTMLElement | null>(null)
const ctaRef = ref<HTMLElement | null>(null)

// ─── Hero banner carousel ───
const banners: BannerSlide[] = [
  {
    src: 'https://i.postimg.cc/rmjqG1nH/banner-one.png',
    title: 'Top Up Mobile Legends',
    subtitle: 'Fast & Secure Diamond Top-Up — Verified via Official API',
    cta: 'Top Up Now',
    ctaGameCode: 'mlbb',
  },
  {
    src: 'https://i.postimg.cc/gjrbvf6B/baner.png',
    title: 'Free Fire Diamonds',
    subtitle: 'Exclusive Bundles & Weekly Passes at the Best Prices',
    cta: 'Shop Now',
    ctaGameCode: 'freefire_kh',
  },
]
const activeBanner = ref(0)
const bannerSlideRef = ref<(HTMLElement | null)[] | null>(null)
let bannerTimer: ReturnType<typeof setInterval> | null = null

// ─── Touch swipe support ───
let touchStartX = 0
let touchDiffX = 0

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX
  touchDiffX = 0
}

function handleTouchMove(e: TouchEvent) {
  if (!touchStartX) return
  touchDiffX = e.touches[0].clientX - touchStartX
}

function handleTouchEnd() {
  const threshold = 50 // minimum px to trigger a slide change
  if (touchDiffX > threshold) {
    previousBanner()
  } else if (touchDiffX < -threshold) {
    nextBanner()
  }
  touchStartX = 0
  touchDiffX = 0
}

function startBannerAutoPlay() {
  stopBannerAutoPlay()
  bannerTimer = setInterval(() => {
    activeBanner.value = (activeBanner.value + 1) % banners.length
  }, 5000)
}

function stopBannerAutoPlay() {
  if (bannerTimer) {
    clearInterval(bannerTimer)
    bannerTimer = null
  }
}

function goToBanner(idx: number) {
  if (idx === activeBanner.value) return
  activeBanner.value = idx
  startBannerAutoPlay()
}

function previousBanner() {
  const prev = activeBanner.value - 1
  goToBanner(prev < 0 ? banners.length - 1 : prev)
}

function nextBanner() {
  const next = activeBanner.value + 1
  goToBanner(next >= banners.length ? 0 : next)
}

// Keyboard navigation
function onBannerKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') {
    previousBanner()
  } else if (e.key === 'ArrowRight') {
    nextBanner()
  }
}

// Animate overlay text when slide changes
let captionTween: gsap.core.Timeline | null = null
function animateBannerCaption() {
  if (captionTween) {
    captionTween.kill()
    captionTween = null
  }
  // v-for refs produce arrays — access the active slide by index
  const activeEl = bannerSlideRef.value?.[activeBanner.value]
  if (!activeEl) return
  const title = activeEl.querySelector('.banner-title')
  const subtitle = activeEl.querySelector('.banner-subtitle')
  const cta = activeEl.querySelector('.banner-cta')
  if (!title && !subtitle && !cta) return
  captionTween = gsap.timeline({ defaults: { ease: 'power3.out' } })
  if (title) {
    captionTween.fromTo(
      title,
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5 }
    )
  }
  if (subtitle) {
    captionTween.fromTo(
      subtitle,
      { y: 16, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45 },
      '-=0.15'
    )
  }
  if (cta) {
    captionTween.fromTo(
      cta,
      { y: 12, opacity: 0, scale: 0.95 },
      { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.6)' },
      '-=0.1'
    )
  }
}

// Animate caption when active banner changes
watch(activeBanner, () => {
  nextTick(() => animateBannerCaption())
})

// ─── Featured cards entrance animation ───
function animateFeaturedCards() {
  if (!featuredRef.value) return
  const cards = featuredRef.value.querySelectorAll('.featured-card-item')
  if (cards.length > 0) {
    gsap.fromTo(
      cards,
      { opacity: 0, y: 16, scale: 0.96 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.45,
        stagger: 0.05,
        ease: 'power2.out',
      }
    )
  }
}

watch(featured, () => {
  nextTick(() => animateFeaturedCards())
})

// ─── Search ───
const searchQuery = ref('')

// ─── Computed ───
const filteredOthers = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return others.value
  return others.value.filter(
    (g) =>
      g.name.toLowerCase().includes(q) ||
      g.game_code.toLowerCase().includes(q) ||
      g.description?.toLowerCase().includes(q)
  )
})

// ─── Navigation ───
function navigateToGame(gameCode: string) {
  analytics.trackGameClick(gameCode)
  router.push(`/game/${gameCode}`)
}

function processGameCategories(data: CambodiaGamesResponse) {
  const all = [...data.featured, ...data.others]

  // Clean, official display names & descriptions for Cambodian top-up store
  const NAME_MAP: Record<string, { name: string; desc?: string }> = {
    freefire_kh: {
      name: 'Free Fire KH/SG',
      desc: 'Garena Free Fire — Official Cambodia & Singapore Server',
    },
    freefire_bonus: {
      name: 'Free Fire Bonus',
      desc: 'Garena Free Fire — Exclusive Bonus Diamond Event Top-Up',
    },
    magic_chess_gogo: {
      name: 'Magic Chess (Cambodia)',
      desc: 'Magic Chess Go Go — Official Cambodia Server & Global Top-Up',
    },
  }

  // Top Games KH: Exactly 6 games to perfectly fill the 6-column desktop grid
  const TARGET_FEATURED = [
    'mlbb',
    'freefire_kh',
    'freefire_bonus',
    'pubgm',
    'hok',
    'magic_chess_gogo',
  ]

  const featuredList: GameCategory[] = []
  for (const code of TARGET_FEATURED) {
    const game = all.find((g) => g.game_code === code)
    if (game) {
      const override = NAME_MAP[code]
      featuredList.push({
        ...game,
        name: override ? override.name : game.name,
        description: override?.desc || game.description,
      })
    }
  }

  const featuredCodes = new Set(featuredList.map((g) => g.game_code))
  const othersList = all
    .filter((g) => !featuredCodes.has(g.game_code))
    .map((g) => {
      const override = NAME_MAP[g.game_code]
      return {
        ...g,
        name: override ? override.name : g.name,
        description: override?.desc || g.description,
      }
    })

  featured.value = featuredList
  others.value = othersList
  gameStore.categories = [...featuredList, ...othersList]
}

// ─── Data fetching (with Instant 0ms SWR Client Cache) ───
async function fetchData(forceRefresh: boolean | unknown = false) {
  const isForced = typeof forceRefresh === 'boolean' ? forceRefresh : false
  // 1. Check client cache first for 0ms instant display
  const cached = clientCache.get<CambodiaGamesResponse>('cambodia_games')
  if (cached && !isForced) {
    processGameCategories(cached.data)
    loading.value = false

    // Pre-warm top games products in background during idle time
    warmTopGamesCache()

    // If cache is fresh, skip network call entirely to protect server
    if (!cached.isStale) return
  } else if (!featured.value.length && !others.value.length) {
    loading.value = true
  }

  error.value = null
  try {
    let data: CambodiaGamesResponse
    try {
      data = await getCambodiaGames()
    } catch {
      // Automatic silent retry after 500ms for mobile / Telegram webviews
      await new Promise((resolve) => setTimeout(resolve, 500))
      data = await getCambodiaGames()
    }
    processGameCategories(data)
    clientCache.set('cambodia_games', data, 15 * 60 * 1000) // 15 mins TTL
    warmTopGamesCache()
  } catch (err) {
    if (!featured.value.length && !others.value.length) {
      error.value = err instanceof Error ? err.message : 'Failed to load games'
    }
  } finally {
    loading.value = false
  }
}

// Pre-warm product catalog for top games so clicking on them loads instantly
function warmTopGamesCache() {
  if (typeof window === 'undefined') return
  const topGames = ['mlbb', 'freefire_sgmy', 'pubgm']
  const runWarm = async () => {
    for (const code of topGames) {
      const cached = clientCache.get(`products_${code}`)
      if (!cached || cached.isStale) {
        try {
          const res = await getProducts(code)
          clientCache.set(`products_${code}`, res, 10 * 60 * 1000)
        } catch { /* silent background warming */ }
      }
    }
  }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => setTimeout(runWarm, 1000))
  } else {
    setTimeout(runWarm, 1500)
  }
}

// ─── Entrance animations ───
function initAnimations() {
  nextTick(() => {
    // Banner caption animation on initial load
    animateBannerCaption()

    // Featured cards (runs now if data already loaded; otherwise deferred to watch(featured))
    animateFeaturedCards()

    // All games cards (scroll-triggered via IntersectionObserver)
    if (allGamesRef.value) {
      const el = allGamesRef.value
      observeScrollAnimation(el, () => {
        const cards = el.querySelectorAll('.game-card-item')
        if (cards.length > 0) {
          gsap.fromTo(
            cards,
            { opacity: 0, y: 20 },
            {
              opacity: 1,
              y: 0,
              duration: 0.35,
              stagger: { amount: 0.4, from: 'start' },
              ease: 'power2.out',
            }
          )
        }
      })
    }
  })
}

onMounted(() => {
  fetchData()
  initAnimations()
  startBannerAutoPlay()
  document.addEventListener('keydown', onBannerKeydown)
})

onUnmounted(() => {
  stopBannerAutoPlay()
  document.removeEventListener('keydown', onBannerKeydown)
  if (captionTween) {
    captionTween.kill()
    captionTween = null
  }
})
</script>

<template>
  <div
    class="min-h-screen bg-[#0B0F17] text-white"
  >
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
      <!-- ═══ HERO BANNER CAROUSEL ═══ -->
      <div
        ref="bannerRef"
        class="relative rounded-2xl overflow-hidden mb-6 sm:mb-8 lg:mb-10 bg-[#131926]/90 border border-[#232D42] shadow-2xl shadow-black/40 group"
        @mouseenter="stopBannerAutoPlay"
        @mouseleave="startBannerAutoPlay"
      >
        <!-- Slides container -->
        <div
          class="relative w-full overflow-hidden bg-surface-100 dark:bg-surface-900 aspect-[1.9/1] sm:aspect-[2.2/1] md:aspect-[2.5/1] lg:aspect-[2.85/1] min-h-[180px] sm:min-h-[230px] lg:min-h-[300px] max-h-[230px] sm:max-h-[320px] md:max-h-[380px] lg:max-h-[430px] touch-pan-y"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
        >
          <div
            v-for="(slide, idx) in banners"
            :key="idx"
            ref="bannerSlideRef"
            class="absolute inset-0 transition-all duration-700 ease-in-out will-change-transform"
            :class="
              idx === activeBanner
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-105'
            "
          >
            <img
              :src="slide.src"
              :alt="slide.title"
              class="w-full h-full object-cover object-center"
              :loading="idx === 0 ? 'eager' : 'lazy'"
            />

            <!-- Gradient overlay for text readability -->
            <div
              class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent"
            ></div>

            <!-- Caption overlay -->
            <div
              class="absolute inset-0 flex items-center justify-start px-5 sm:px-8 md:px-10 lg:px-14"
            >
              <div
                class="max-w-md sm:max-w-lg lg:max-w-xl text-left pointer-events-auto"
              >
                <!-- Title -->
                <h2
                  class="banner-title text-lg sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-extrabold text-white leading-tight text-balance drop-shadow-lg"
                >
                  {{ slide.title }}
                </h2>

                <!-- Subtitle -->
                <p
                  class="banner-subtitle mt-1.5 sm:mt-2 text-xs sm:text-sm md:text-base text-white/80 max-w-md text-balance leading-relaxed drop-shadow line-clamp-2 sm:line-clamp-none"
                >
                  {{ slide.subtitle }}
                </p>

                <!-- CTA Button -->
                <div class="banner-cta mt-3 sm:mt-4">
                  <button
                    @click="navigateToGame(slide.ctaGameCode)"
                    class="inline-flex items-center gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-400 hover:to-primary-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/40 transition-all duration-300 hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    {{ slide.cta }}
                    <svg
                      class="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform duration-300 group-hover:translate-x-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="M17 8l4 4m0 0l-4 4m4-4H3"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Left arrow -->
        <button
          @click="previousBanner"
          aria-label="Previous slide"
          class="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm border border-white/30 dark:border-surface-700/30 shadow-lg flex items-center justify-center text-surface-600 dark:text-surface-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-white dark:hover:bg-surface-800 hover:scale-105 active:scale-95 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <!-- Right arrow -->
        <button
          @click="nextBanner"
          aria-label="Next slide"
          class="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm border border-white/30 dark:border-surface-700/30 shadow-lg flex items-center justify-center text-surface-600 dark:text-surface-300 opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-white dark:hover:bg-surface-800 hover:scale-105 active:scale-95 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <!-- Navigation dots + counter -->
        <div
          class="absolute bottom-3 sm:bottom-4 lg:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10"
        >
          <button
            v-for="(_, idx) in banners"
            :key="idx"
            @click="goToBanner(idx)"
            :aria-label="'Go to slide ' + (idx + 1)"
            class="rounded-full transition-all duration-500 ease-out cursor-pointer"
            :class="[
              idx === activeBanner
                ? 'w-6 sm:w-8 h-2 sm:h-2.5 bg-white shadow-md'
                : 'w-2 h-2 sm:w-2.5 sm:h-2.5 bg-white/40 hover:bg-white/70',
            ]"
          ></button>

          <!-- Slide counter -->
          <span
            class="text-[10px] sm:text-xs font-mono font-medium text-white/70 tracking-wider select-none"
          >
            {{ activeBanner + 1 }}
            <span class="text-white/30 mx-px">/</span>
            {{ banners.length }}
          </span>
        </div>
      </div>

      <!-- ═══ LOADING STATE ═══ -->
      <div v-if="loading" class="w-full space-y-8 sm:space-y-10">
        <div>
          <div class="flex items-center gap-3 mb-5 sm:mb-6">
            <div
              class="w-1 h-5 sm:h-6 rounded-full bg-gradient-to-b from-amber-400/40 to-orange-500/40"
            ></div>
            <div
              class="h-5 sm:h-6 w-36 rounded-lg bg-surface-200 dark:bg-surface-700/60 skeleton-subtle"
            ></div>
          </div>
          <LoadingSkeleton variant="featured-card" :count="4" />
        </div>
        <div
          class="h-px bg-gradient-to-r from-transparent via-surface-300 dark:via-surface-600 to-transparent"
        ></div>
        <div>
          <div class="flex items-center gap-3 mb-5 sm:mb-6">
            <div
              class="w-1 h-5 sm:h-6 rounded-full bg-gradient-to-b from-primary-400/40 to-primary-600/40"
            ></div>
            <div
              class="h-5 sm:h-6 w-28 rounded-lg bg-surface-200 dark:bg-surface-700/60 skeleton-subtle"
            ></div>
          </div>
          <LoadingSkeleton variant="game-card" :count="12" />
        </div>
      </div>

      <!-- ═══ ERROR STATE ═══ -->
      <div v-else-if="error" class="text-center py-16">
        <div
          class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/20 mb-4"
        >
          <svg
            class="w-7 h-7 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p class="text-surface-500 dark:text-surface-400 text-sm mb-4">
          {{ error }}
        </p>
        <button @click="fetchData" class="btn-primary text-sm">
          <svg
            class="w-4 h-4 inline mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Try Again
        </button>
      </div>

      <!-- ═══ GAMES CONTENT ═══ -->
      <div
        v-else
        class="w-full space-y-8 sm:space-y-10 lg:space-y-12"
      >
        <!-- ─── FEATURED GAMES (Top Games) ─── -->
        <div v-if="featured.length > 0" ref="featuredRef">
          <div class="flex items-center justify-between mb-3 sm:mb-6">
            <div class="flex items-center gap-2.5 sm:gap-3">
              <div class="w-1.5 h-5 sm:h-6 rounded-full bg-gradient-to-b from-[#FF385C] to-amber-500"></div>
              <h2 class="text-sm sm:text-lg font-extrabold text-white uppercase tracking-wider">
                Top Games
              </h2>
            </div>
            <span class="sm:hidden text-[10px] font-medium text-slate-400 flex items-center gap-0.5 shrink-0">
              Scroll &rarr;
            </span>
          </div>

          <!-- Mobile: Smooth Horizontal Scroll | Tablet/Desktop: Clean 6-Column Grid -->
          <div class="flex sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-4 overflow-x-auto sm:overflow-x-visible pb-2.5 sm:pb-0 scrollbar-none snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
            <div
              v-for="game in featured"
              :key="game.game_code"
              class="featured-card-item w-[130px] sm:w-auto shrink-0 snap-start"
            >
              <div
                @click="navigateToGame(game.game_code)"
                class="group relative cursor-pointer rounded-xl sm:rounded-2xl overflow-hidden bg-[#131926]/90 border border-[#232D42] hover:border-[#FF385C]/70 transition-all duration-300 hover:shadow-[0_10px_25px_rgba(255,56,92,0.22)] hover:-translate-y-1 block select-none h-full"
              >
                <!-- Badge for Top Games -->
                <div class="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 z-10">
                  <span class="px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] text-white shadow-md">
                    Top Pick
                  </span>
                </div>

                <div class="aspect-[4/3] overflow-hidden bg-[#0B0F17] relative">
                  <img
                    :src="game.image_url"
                    :alt="game.name"
                    class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/25 to-transparent"></div>
                </div>

                <div class="p-2 sm:p-2.5 bg-[#131926]/90">
                  <h3 class="text-xs sm:text-sm font-bold text-white truncate group-hover:text-[#FF385C] transition-colors duration-200">
                    {{ game.name }}
                  </h3>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── DIVIDER ─── -->
        <div
          v-if="others.length > 0"
          class="h-px bg-gradient-to-r from-transparent via-surface-300 dark:via-surface-600 to-transparent"
        ></div>

        <!-- ─── ALL GAMES ─── -->
        <div v-if="others.length > 0" ref="allGamesRef">
          <div
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 sm:mb-6"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-1 h-5 sm:h-6 rounded-full bg-gradient-to-b from-primary-400 to-primary-600"
              ></div>
              <h2
                class="text-base sm:text-lg font-bold text-surface-900 dark:text-white uppercase tracking-wider"
              >
                All Games
              </h2>
              <span
                class="text-xs text-surface-400 dark:text-surface-500 font-mono"
                >({{ filteredOthers.length }})</span
              >
            </div>

            <div class="relative w-full sm:w-64">
              <svg
                class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                v-model="searchQuery"
                type="text"
                placeholder="Search games..."
                class="w-full pl-10 pr-4 py-2 bg-[#131926]/90 border border-[#232D42] rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-[#FF385C]/30 focus:border-[#FF385C]/60 transition-all duration-200"
              />
              <button
                v-if="searchQuery"
                @click="searchQuery = ''"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div
            v-if="filteredOthers.length === 0 && searchQuery"
            class="text-center py-12"
          >
            <div
              class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-100 dark:bg-surface-800 mb-3"
            >
              <svg
                class="w-6 h-6 text-surface-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <p class="text-sm text-surface-500 dark:text-surface-400">
              No games matching
              "<span class="text-surface-700 dark:text-surface-300 font-medium">{{
                searchQuery
              }}</span>"
            </p>
          </div>

          <div
            v-if="filteredOthers.length > 0"
            class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-4"
          >
            <div
              v-for="game in filteredOthers"
              :key="game.game_code"
              class="game-card-item"
            >
              <div
                @click="navigateToGame(game.game_code)"
                class="group relative cursor-pointer rounded-xl sm:rounded-2xl overflow-hidden bg-[#131926]/90 border border-[#232D42] hover:border-[#FF385C]/60 transition-all duration-300 hover:shadow-[0_8px_20px_rgba(255,56,92,0.16)] hover:-translate-y-1 block select-none h-full"
              >
                <div class="aspect-[4/3] overflow-hidden bg-[#0B0F17] relative">
                  <img
                    :src="game.image_url"
                    :alt="game.name"
                    class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div
                    class="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/25 to-transparent"
                  ></div>
                </div>
                <div class="p-1.5 sm:p-2.5 bg-[#131926]/90">
                  <p
                    class="text-[11px] sm:text-sm font-bold text-white truncate group-hover:text-[#FF385C] transition-colors duration-200"
                  >
                    {{ game.name }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ TRUST SECTION ═══ -->
        <div ref="ctaRef">
          <div class="max-w-lg mx-auto text-center">
            <div
              class="p-5 sm:p-8 rounded-2xl bg-[#131926]/90 border border-[#232D42] shadow-xl"
            >
              <div class="flex items-center justify-center gap-2 mb-5">
                <svg
                  class="w-4 h-4 text-emerald-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span
                  class="text-xs text-surface-500 dark:text-surface-400 uppercase tracking-[0.2em] font-semibold"
                  >Trusted &amp; Secure</span
                >
              </div>

              <div class="grid grid-cols-3 gap-4 sm:gap-6">
                <div class="text-center">
                  <div
                    class="w-10 h-10 mx-auto rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mb-2"
                  >
                    <svg
                      class="w-5 h-5 text-primary-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <p class="text-[11px] text-surface-500 dark:text-surface-400 font-medium">
                    Secure<br />KHQR Pay
                  </p>
                </div>
                <div class="text-center">
                  <div
                    class="w-10 h-10 mx-auto rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-2"
                  >
                    <svg
                      class="w-5 h-5 text-emerald-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <p class="text-[11px] text-surface-500 dark:text-surface-400 font-medium">
                    Instant<br />Delivery
                  </p>
                </div>
                <div class="text-center">
                  <div
                    class="w-10 h-10 mx-auto rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center mb-2"
                  >
                    <svg
                      class="w-5 h-5 text-amber-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <p class="text-[11px] text-surface-500 dark:text-surface-400 font-medium">
                    Best<br />Prices
                  </p>
                </div>
              </div>
            </div>

            <p
              class="mt-5 text-[10px] text-surface-400 dark:text-surface-500 font-medium tracking-wider flex items-center justify-center gap-1.5"
            >
              <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Powered for Cambodian Gamers — KHQR Payment via Bakong</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
