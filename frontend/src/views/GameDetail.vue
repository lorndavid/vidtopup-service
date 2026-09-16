<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import ProductCard from '@/components/ProductCard.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { verifyPlayer, createPayment, getPaymentStatus, cancelOrder, getOrder, getNewProductsConfig, getPriceDropsByGame } from '@/services/api'
import type { GameProduct } from '@/types'
import { useSavedPlayers } from '@/composables/useSavedPlayers'
import { formatPrice } from '@/composables/useCurrency'
import { getGameCurrency, extractAmount } from '@/utils/gameCurrency'
import { getPackageVisual } from '@/utils/packageVisuals'
import { usePaymentWebSocket } from '@/composables/usePaymentWebSocket'
import ReceiptCard from '@/components/ReceiptCard.vue'
import { useScrollToTop } from '@/composables/useScrollToTop'
import { usePushNotifications } from '@/composables/usePushNotifications'
import { useBalanceBadge } from '@/composables/useBalanceBadge'
import { useAnalytics } from '@/composables/useAnalytics'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

const route = useRoute()

// ─── Wallet balance badge (real-time) ───
const { balance: walletBalance, loading: balanceLoading } = useBalanceBadge()

const balanceStatus = computed<'in-stock' | 'low-stock' | 'out-of-stock'>(() => {
  if (walletBalance.value > 5) return 'in-stock'
  if (walletBalance.value > 0) return 'low-stock'
  return 'out-of-stock'
})

const balanceLabel = computed(() => {
  const map = { 'in-stock': 'In Stock', 'low-stock': 'Low Stock', 'out-of-stock': 'Out of Stock' }
  return map[balanceStatus.value]
})

const balanceIcon = computed(() => {
  const map = {
    'in-stock': 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    'low-stock': 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    'out-of-stock': 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  }
  return map[balanceStatus.value]
})

const balanceBadgeColors = computed(() => {
  const map = {
    'in-stock': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    'low-stock': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'out-of-stock': 'bg-red-500/20 text-red-300 border-red-500/30',
  }
  return map[balanceStatus.value]
})

const balanceDotColors = computed(() => {
  const map = {
    'in-stock': 'bg-emerald-400',
    'low-stock': 'bg-amber-400',
    'out-of-stock': 'bg-red-400',
  }
  return map[balanceStatus.value]
})

// ─── Push notifications (subscribe after payment success) ───
const { subscribe: subscribePush } = usePushNotifications()
const router = useRouter()
const analytics = useAnalytics()
const gameStore = useGameStore()
const i18n = useI18nStore()
const toast = useToastStore()

const gameCode = computed(() => route.params.gameCode as string)

// ─── Refs ────────────────────────────────────────────────────
const pageRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const formRef = ref<HTMLElement | null>(null)
const productsContainerRef = ref<HTMLElement | null>(null)
const productsListRef = ref<HTMLElement | null>(null)
const resultRef = ref<HTMLElement | null>(null)
const errorRef = ref<HTMLElement | null>(null)
const serverIdRef = ref<HTMLElement | null>(null)
const proceedBtnRef = ref<HTMLElement | null>(null)
const savedChipsRef = ref<HTMLElement | null>(null)

// ─── Scroll-to-top button (appears when scrolling past products) ───
const { showScrollTop, scrollToTop } = useScrollToTop(productsContainerRef, 100)

const selectedProduct = ref<GameProduct | null>(null)
const selectedVisual = computed(() => {
  if (!selectedProduct.value) return null
  return getPackageVisual(gameCode.value, selectedProduct.value.name, selectedProduct.value.product_code)
})
const playerId = ref('')
const serverId = ref('')
const skipAutoVerify = ref(false)

// Verification state
const verifying = ref(false)
const verified = ref(false)
const verifyError = ref<string | null>(null)
const playerNickname = ref<string | null>(null)
const playerRegion = ref<string | null>(null)
const playerGameTitle = ref<string | null>(null)
const verifyProvider = ref<string | null>(null)

// Track previous canProceed for pulse effect
const prevCanProceed = ref(false)

// Saved Players (localStorage for returning customers)
const { getByGame, save } = useSavedPlayers()
const savedForGame = ref<ReturnType<typeof getByGame>>([])

// ─── Computed ────────────────────────────────────────────────
const needsServerId = computed(() => {
  const category = gameStore.categories.find((c) => c.game_code === gameCode.value)
  return category?.game_fields?.includes('serverid') ?? false
})

const canProceed = computed(() => {
  return !!(selectedProduct.value && verified.value && playerId.value.trim())
})

const gameDisplayName = computed(() => {
  return gameStore.selectedGame?.name || gameCode.value
})

const gameCurrency = computed(() => getGameCurrency(gameCode.value))

const gameImageUrl = computed(() => gameStore.selectedGame?.image_url || '')

// ─── New products config (fetched from backend) ───
const newProductAmounts = ref<Record<string, Set<number>>>({})
const priceDrops = ref<Record<string, number>>({})

onMounted(async () => {
  try {
    const [config, drops] = await Promise.all([
      getNewProductsConfig(),
      getPriceDropsByGame(gameCode.value),
    ])
    // Convert number[] to Set<number> for fast lookup
    const mapped: Record<string, Set<number>> = {}
    for (const [code, amounts] of Object.entries(config)) {
      if (amounts.length > 0) {
        mapped[code] = new Set(amounts)
      }
    }
    newProductAmounts.value = mapped
    priceDrops.value = drops
  } catch {
    // Silently fail — badges just won't show
  }
})

const productsNeedingNewBadge = computed<Set<string>>(() => {
  const amounts = newProductAmounts.value[gameCode.value]
  if (!amounts) return new Set()
  const codes = new Set<string>()
  for (const p of gameStore.products) {
    const amt = parseFloat(extractAmount(p.name))
    if (amounts.has(amt)) codes.add(p.product_code)
  }
  return codes
})

const productsWithPriceDrop = computed<Set<string>>(() => {
  const codes = new Set<string>()
  const drops = priceDrops.value
  for (const code of Object.keys(drops)) {
    if (drops[code] > 0) codes.add(code)
  }
  return codes
})

// ─── Product stagger reveal (one-shot guard prevents re-trigger flash) ───
type ProductBadge = 'best-value' | 'most-popular' | 'new' | 'price-drop' | null
type SortMode = 'default' | 'most-popular' | 'best-value' | 'cheapest' | 'price-high'

const activeSort = ref<SortMode>('default')

/** Compute price-per-unit for every product (shared by badges + sort) */
const productsWithPPU = computed(() => {
  return gameStore.products.map((p) => ({
    product: p,
    amount: parseFloat(extractAmount(p.name)),
    ppu: (() => {
      const amt = parseFloat(extractAmount(p.name))
      return amt > 0 ? p.sell_price / amt : Infinity
    })(),
  }))
})

/** Sorted products based on active sort mode */
const sortedProducts = computed(() => {
  const items = [...productsWithPPU.value]
  if (activeSort.value === 'cheapest') {
    items.sort((a, b) => a.product.sell_price - b.product.sell_price)
  } else if (activeSort.value === 'best-value') {
    items.sort((a, b) => a.ppu - b.ppu)
  } else if (activeSort.value === 'price-high') {
    items.sort((a, b) => b.product.sell_price - a.product.sell_price)
  } else if (activeSort.value === 'most-popular') {
    // Push the most-popular-badged product to the very top, then PPU ascending
    const badges = productBadges.value
    items.sort((a, b) => {
      const aPopular = badges.get(a.product.product_code) === 'most-popular' ? -1 : 0
      const bPopular = badges.get(b.product.product_code) === 'most-popular' ? -1 : 0
      if (aPopular !== bPopular) return aPopular - bPopular
      return a.ppu - b.ppu
    })
  }
  // 'default' keeps original API order
  return items.map((i) => i.product)
})

const productBadges = computed<Map<string, ProductBadge>>(() => {
  const map = new Map<string, ProductBadge>()
  const items = productsWithPPU.value
  const valid = items.filter((i) => i.amount > 0)
  if (valid.length < 3) return map

  // Sort by price per unit ascending
  const sorted = [...valid].sort((a, b) => a.ppu - b.ppu)

  // Best Value = lowest price per unit
  map.set(sorted[0].product.product_code, 'best-value')

  // Most Popular = middle of the sorted list
  const midIdx = Math.floor((sorted.length - 1) / 2)
  const midCode = sorted[midIdx].product.product_code
  const bestCode = sorted[0].product.product_code
  if (midCode !== bestCode) {
    map.set(midCode, 'most-popular')
  } else if (sorted.length > 1) {
    map.set(sorted[1].product.product_code, 'most-popular')
  }

  return map
})

const showServerIdHelp = ref(false)

const bestSellingProducts = computed(() => {
  const passesAndBadges = sortedProducts.value.filter((p) => {
    const v = getPackageVisual(gameCode.value, p.name, p.product_code)
    return (
      v.isPass ||
      productBadges.value.get(p.product_code) === 'most-popular' ||
      productBadges.value.get(p.product_code) === 'best-value' ||
      productsWithPriceDrop.value.has(p.product_code)
    )
  })
  if (passesAndBadges.length >= 2) return passesAndBadges.slice(0, 4)
  if (sortedProducts.value.length > 4) return sortedProducts.value.slice(0, 4)
  return []
})

const generalProducts = computed(() => {
  if (bestSellingProducts.value.length === 0) return sortedProducts.value
  const bestCodes = new Set(bestSellingProducts.value.map((p) => p.product_code))
  return sortedProducts.value.filter((p) => !bestCodes.has(p.product_code))
})

const staggerDone = ref(false)

watch(
  () => gameStore.products,
  (products) => {
    if (products.length > 0 && !staggerDone.value) {
      staggerDone.value = true
      nextTick(() => {
        const items = productsListRef.value?.querySelectorAll('.product-card')
        if (!items || items.length === 0) return

        // Kill any existing tweens on product cards
        gsap.killTweensOf(items)

        // Stagger reveal — GSAP fromTo immediately applies the 'from' state
        // so there's no flash of visible -> hidden -> animate
        gsap.fromTo(
          items,
          { opacity: 0, y: 20, scale: 0.96 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.45,
            stagger: { each: 0.06, from: 'start', ease: 'power2.out' },
            ease: 'back.out(1.4)',
          }
        )
      })
    }
  },
  { immediate: true }
)

// ─── Watchers ────────────────────────────────────────────────
// ─── Auto-verify when user fills in ID fields ───
let verifyDebounce: ReturnType<typeof setTimeout> | null = null

watch([playerId, serverId], () => {
  // Skip auto-verify when restoring a saved player from localStorage
  if (skipAutoVerify.value) {
    skipAutoVerify.value = false
    return
  }
  if (verifyDebounce) {
    clearTimeout(verifyDebounce)
    verifyDebounce = null
  }
  if (verified.value) {
    verified.value = false
    verifyError.value = null
    playerNickname.value = null
    playerRegion.value = null
    playerGameTitle.value = null
    verifyProvider.value = null
  }
  const id = playerId.value.trim()
  if (!id) return
  // Minimum length check: MLBB UIDs are 6+ digits, most games need 5+ chars
  if (id.length < 5) return
  if (needsServerId.value && !serverId.value.trim()) return
  if (needsServerId.value && serverId.value.trim().length < 3) return
  verifyDebounce = setTimeout(() => {
    handleVerify()
  }, 600)
})

// Simple slide-in for verify success card (handled by Transition CSS)

// Smooth error slide-in + shake (staggered after success animations)
watch(verifyError, (err) => {
  if (err && errorRef.value) {
    gsap.killTweensOf(errorRef.value)
    nextTick(() => {
      const tl = gsap.timeline({ delay: 0.1 })
      tl.set(errorRef.value, { opacity: 0, y: -8, maxHeight: 0, x: 0 })
      tl.to(errorRef.value, {
        opacity: 1, y: 0, maxHeight: 200,
        duration: 0.25,
        ease: 'power3.out',
      })
      // Horizontal shake with dramatic damping curve ±8px → ±2px
      tl.to(errorRef.value, { x: -8, duration: 0.05 })
      tl.to(errorRef.value, { x: 8, duration: 0.05 })
      tl.to(errorRef.value, { x: -6, duration: 0.05 })
      tl.to(errorRef.value, { x: 6, duration: 0.05 })
      tl.to(errorRef.value, { x: -4, duration: 0.05 })
      tl.to(errorRef.value, { x: 4, duration: 0.05 })
      tl.to(errorRef.value, { x: -2, duration: 0.05 })
      tl.to(errorRef.value, { x: 2, duration: 0.05 })
      tl.to(errorRef.value, { x: 0, duration: 0.05 })
    })
  }
})

// Server ID field slide animation when it appears
watch(needsServerId, () => {
  nextTick(() => {
    if (serverIdRef.value) {
      // Apply hidden state first, then animate in — prevents flash
      gsap.set(serverIdRef.value, { opacity: 0, y: -10, maxHeight: 0 })
      gsap.to(serverIdRef.value, { opacity: 1, y: 0, maxHeight: 200, duration: 0.35, ease: 'power3.out' })
    }
  })
})

// Proceed button pulse when canProceed becomes true
watch(canProceed, (val) => {
  if (val && !prevCanProceed.value && proceedBtnRef.value) {
    nextTick(() => {
      gsap.fromTo(
        proceedBtnRef.value,
        { boxShadow: '0 0 0 rgba(37, 99, 235, 0)' },
        {
          boxShadow: '0 0 30px rgba(37, 99, 235, 0.4), 0 0 60px rgba(37, 99, 235, 0.15)',
          duration: 0.6,
          ease: 'power2.out',
          yoyo: true,
          repeat: 1,
        }
      )
    })
  }
  prevCanProceed.value = val
})

// ─── Saved chip entrance ────────────────────────────────────
watch(savedForGame, (chips) => {
  if (chips.length > 0) {
    nextTick(() => {
      const els = savedChipsRef.value?.querySelectorAll('.saved-chip')
      if (els && els.length > 0) {
        gsap.fromTo(
          els,
          { opacity: 0, scale: 0.85, y: 8 },
          { opacity: 1, scale: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'back.out(2)' }
        )
      }
    })
  }
})

// ─── Balance eligibility check (Free Fire SG "Less is More" 520-diamond package) ───
/** Config: game codes → set of diamond amounts that require balance confirmation */
const BALANCE_CHECK_REQUIRED: Record<string, Set<number>> = {
  freefire_sgmy: new Set([520]),
  'freefire_sg': new Set([520]),
}

const showBalanceDialog = ref(false)
const balanceConfirmed = ref(false)

const selectedNeedsBalanceCheck = computed(() => {
  if (!selectedProduct.value) return false
  const amounts = BALANCE_CHECK_REQUIRED[gameCode.value]
  if (!amounts) return false
  const amt = parseFloat(extractAmount(selectedProduct.value.name))
  return amounts.has(amt)
})

const productsNeedingBalanceCheck = computed<Set<string>>(() => {
  const amounts = BALANCE_CHECK_REQUIRED[gameCode.value]
  if (!amounts) return new Set()
  const codes = new Set<string>()
  for (const p of gameStore.products) {
    const amt = parseFloat(extractAmount(p.name))
    if (amounts.has(amt)) codes.add(p.product_code)
  }
  return codes
})

function openBalanceDialog() {
  balanceConfirmed.value = false
  showBalanceDialog.value = true
}

function closeBalanceDialog() {
  showBalanceDialog.value = false
  balanceConfirmed.value = false
}

/** Called after user confirms eligibility in the dialog */
function proceedWithBalanceCheck() {
  showBalanceDialog.value = false
  executePayNow()
}

const isMobileFlow = ref(false)

// ─── Methods ─────────────────────────────────────────────────
function selectProduct(product: GameProduct) {
  selectedProduct.value = product
  analytics.track('product_select', {
    game_code: gameCode.value,
    product_code: product.product_code,
  })
}

async function handleVerify() {
  const id = playerId.value.trim()
  if (!id) {
    toast.warning(i18n.t('detail.toast.enterPlayerId'))
    return
  }

  verifying.value = true
  verifyError.value = null
  verified.value = false

  try {
    const result = await verifyPlayer({
      game_code: gameCode.value,
      player_id: id,
      server_id: serverId.value.trim() || undefined,
    })

    if (result.verified && result.nickname) {
      verified.value = true
      playerNickname.value = result.nickname
      playerRegion.value = result.region || null
      playerGameTitle.value = result.gameTitle || null
      verifyProvider.value = result.provider || null

      analytics.track('verify_player', {
        game_code: gameCode.value,
        event_data: { nickname: result.nickname },
      })

      toast.success(i18n.t('verify.successMessage'))

      // Save to localStorage so returning users can re-select instantly
      save({
        gameCode: gameCode.value,
        playerId: id,
        serverId: serverId.value.trim() || undefined,
        nickname: result.nickname,
        region: result.region,
        gameTitle: result.gameTitle,
      })
      // Refresh the saved players list
      loadSavedPlayers()
    } else {
      verifyError.value = i18n.t('verify.error.notFound')
    }
  } catch {
    verifyError.value = i18n.t('verify.error.generic')
  } finally {
    verifying.value = false
  }
}

// ─── Mobile One-Step Checkout ───────────────────────
const mobileCheckoutActive = ref(false)
const mobileQrImage = ref('')
const mobileCheckoutUrl = ref('')
const mobilePaymentRef = ref('')
const mobileQrLoading = ref(false)
const mobileQrError = ref<string | null>(null)
const mobilePaymentStatus = ref<'pending' | 'paid' | 'failed'>('pending')
const mobileTimeLeft = ref(5 * 60)
const mobileUrgent = computed(() => mobileTimeLeft.value < 60 && mobilePaymentStatus.value === 'pending')

// Receipt data (fetched from API when payment succeeds)
const mobileOrderData = ref<{
  reference: string
  game_name: string
  product_name: string
  player_id: string
  server_id?: string | null
  amount: number
  payment_status: string
  order_status: string
  created_at: string
  completed_at?: string | null
} | null>(null)
const mobileReceiptLoading = ref(false)

// WebSocket for real-time payment status (mobile checkout)
const mobileWsRef = ref<string | null>(null)
const mobileWs = usePaymentWebSocket(mobileWsRef)
mobileWs.setOnStatusChange((data) => {
  if (data.payment_status === 'paid') {
    mobilePaymentStatus.value = 'paid'
    stopMobilePolling()
    playSuccessSound()
    fetchMobileOrderData()
    toast.success('Payment received! Redirecting...')
    analytics.trackPayment('completed', {
      game_code: gameCode.value,
      product_code: selectedProduct.value?.product_code,
      amount: selectedProduct.value?.sell_price,
      reference: mobilePaymentRef.value,
    })
    // Subscribe to push notifications after successful payment
    subscribePush().catch(() => {})
    setTimeout(() => {
      router.push('/order/' + mobilePaymentRef.value)
    }, 3000)
  } else if (data.payment_status === 'failed') {
    mobilePaymentStatus.value = 'failed'
    stopMobilePolling()
    analytics.trackPayment('failed', {
      game_code: gameCode.value,
      product_code: selectedProduct.value?.product_code,
      amount: selectedProduct.value?.sell_price,
      reference: mobilePaymentRef.value,
    })
    toast.error('Payment failed')
  }
})

async function fetchMobileOrderData() {
  if (!mobilePaymentRef.value) return
  mobileReceiptLoading.value = true
  try {
    const order = await getOrder(mobilePaymentRef.value)
    mobileOrderData.value = {
      reference: order.reference,
      game_name: order.game_name,
      product_name: order.product_name,
      player_id: order.player_id,
      server_id: order.server_id || null,
      amount: order.amount,
      payment_status: order.payment_status,
      order_status: order.order_status,
      created_at: order.created_at,
      completed_at: order.completed_at || null,
    }
  } catch {
    // If fetch fails, use local data as fallback
    mobileOrderData.value = {
      reference: mobilePaymentRef.value,
      game_name: gameDisplayName.value,
      product_name: selectedProduct.value?.name || '',
      player_id: playerId.value,
      server_id: serverId.value || null,
      amount: selectedProduct.value?.sell_price || 0,
      payment_status: 'paid',
      order_status: 'paid',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }
  } finally {
    mobileReceiptLoading.value = false
  }
}

let mobilePollInterval: ReturnType<typeof setInterval> | null = null
let mobileTimerInterval: ReturnType<typeof setInterval> | null = null

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const now = ctx.currentTime
    const notes = [523, 659, 784]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.12)
      gain.gain.setValueAtTime(0.2, now + i * 0.12)
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.4)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.12)
      osc.stop(now + i * 0.12 + 0.4)
    })
  } catch { /* silent */ }
}

async function copyPaymentRef() {
  if (!mobilePaymentRef.value) return
  try {
    await navigator.clipboard.writeText(mobilePaymentRef.value)
    toast.success('Payment reference copied to clipboard!')
  } catch {
    toast.error('Failed to copy')
  }
}

async function handlePayNow() {
  if (!selectedProduct.value) {
    toast.warning(i18n.t('detail.toast.selectPackage'))
    return
  }
  if (!playerId.value.trim()) {
    toast.warning(i18n.t('detail.toast.enterPlayerId'))
    return
  }
  if (!verified.value) {
    toast.warning(i18n.t('verify.mustVerify'))
    return
  }
  if (needsServerId.value && !serverId.value.trim()) {
    toast.warning(i18n.t('detail.toast.enterServerId'))
    return
  }

  // If this package requires balance confirmation, show the dialog first
  if (selectedNeedsBalanceCheck.value) {
    openBalanceDialog()
    return
  }

  await executePayNow()
}

// Aliases for template callers
const handleMobileCheckout = handlePayNow
const proceedToCheckout = handlePayNow

async function executePayNow() {
  if (!selectedProduct.value || !playerId.value.trim() || !verified.value) return

  // Set the order in store first
  gameStore.setOrder({
    gameName: gameDisplayName.value,
    gameCode: gameCode.value,
    productName: selectedProduct.value.name,
    productCode: selectedProduct.value.product_code,
    amount: selectedProduct.value.sell_price,
    playerId: playerId.value.trim(),
    serverId: serverId.value.trim() || undefined,
    verifyProvider: verifyProvider.value || undefined,
  })

  if (!gameStore.currentOrder) return

  analytics.trackPayment('initiated', {
    game_code: gameCode.value,
    product_code: selectedProduct.value.product_code,
    amount: selectedProduct.value.sell_price,
  })

  mobileCheckoutActive.value = true
  mobileQrLoading.value = true
  mobileQrError.value = null

  try {
    const result = await createPayment({
      game_code: gameCode.value,
      product_code: selectedProduct.value.product_code,
      product_name: selectedProduct.value.name,
      game_name: gameDisplayName.value,
      player_id: playerId.value.trim(),
      server_id: serverId.value.trim() || undefined,
      amount: selectedProduct.value.sell_price,
    })

    mobilePaymentRef.value = result.reference
    mobileWsRef.value = result.reference
    mobileQrImage.value = result.khqr_image || ''
    mobileCheckoutUrl.value = result.checkout_url || ''
    mobilePaymentStatus.value = 'pending'
    mobileTimeLeft.value = 5 * 60

    // Start polling + timer
    startMobilePolling()
    startMobileTimer()
  } catch (err) {
    mobileQrError.value = err instanceof Error ? err.message : 'Failed to create payment'
    toast.error(mobileQrError.value)
  } finally {
    mobileQrLoading.value = false
  }
}

const executeMobileCheckout = executePayNow
const executeProceedToCheckout = executePayNow

function startMobilePolling() {
  mobilePollInterval = setInterval(async () => {
    if (!mobilePaymentRef.value) return
    try {
      const status = await getPaymentStatus(mobilePaymentRef.value)
      mobilePaymentStatus.value = status.payment_status as 'pending' | 'paid' | 'failed'
      if (status.payment_status === 'paid') {
        stopMobilePolling()
        playSuccessSound()
        fetchMobileOrderData()
        toast.success('Payment received! Redirecting...')
        analytics.trackPayment('completed', {
          game_code: gameCode.value,
          product_code: selectedProduct.value?.product_code,
          amount: selectedProduct.value?.sell_price,
          reference: mobilePaymentRef.value,
        })
        // Subscribe to push notifications after successful payment
        subscribePush().catch(() => {})
        setTimeout(() => router.push('/order/' + mobilePaymentRef.value), 1500)
      } else if (status.payment_status === 'failed') {
        stopMobilePolling()
        analytics.trackPayment('failed', {
          game_code: gameCode.value,
          product_code: selectedProduct.value?.product_code,
          amount: selectedProduct.value?.sell_price,
          reference: mobilePaymentRef.value,
        })
        toast.error('Payment failed')
      }
    } catch { /* silent */ }
  }, 3000)
}

function stopMobilePolling() {
  if (mobilePollInterval) { clearInterval(mobilePollInterval); mobilePollInterval = null }
  if (mobileTimerInterval) { clearInterval(mobileTimerInterval); mobileTimerInterval = null }
}

function startMobileTimer() {
  mobileTimerInterval = setInterval(() => {
    mobileTimeLeft.value--
    if (mobileTimeLeft.value <= 0) {
      stopMobilePolling()
      toast.error('Payment time expired')
      cancelOrder(mobilePaymentRef.value).catch(() => {})
      mobilePaymentStatus.value = 'failed'
    }
  }, 1000)
}

function closeMobileCheckout() {
  stopMobilePolling()
  cancelOrder(mobilePaymentRef.value).catch(() => {})
  mobileCheckoutActive.value = false
  mobileQrImage.value = ''
  mobileCheckoutUrl.value = ''
  mobilePaymentRef.value = ''
  mobilePaymentStatus.value = 'pending'
  mobileTimeLeft.value = 5 * 60
}

function downloadQrImage() {
  if (mobileQrImage.value) {
    const link = document.createElement('a')
    link.href = mobileQrImage.value
    link.download = 'KHQR-payment.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}

// ─── Saved Players ─────────────────────────────────
/** Load previously verified player IDs for this game from localStorage. */
function loadSavedPlayers() {
  savedForGame.value = getByGame(gameCode.value)
}

/** Select a saved player: auto-fill ID, server, and restore cached verification instantly. */
function selectSavedPlayer(saved: ReturnType<typeof getByGame>[number]) {
  skipAutoVerify.value = true
  playerId.value = saved.playerId
  serverId.value = saved.serverId || ''
  verified.value = true
  playerNickname.value = saved.nickname
  playerRegion.value = saved.region || null
  playerGameTitle.value = saved.gameTitle || null
  verifyError.value = null

  // Scroll to show the verified result card
  if (resultRef.value) {
    resultRef.value.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

// ─── Desktop & Mobile checkout unified into handlePayNow ───

// ─── Lifecycle ───────────────────────────────────────────────
onMounted(() => {
  if (gameCode.value) {
    gameStore.fetchProducts(gameCode.value)
  }

  // Load saved player IDs from localStorage for this game
  loadSavedPlayers()

  // Page entrance animation
  nextTick(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    // Page fade in
    tl.fromTo(
      pageRef.value,
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 0.5 }
    )

    // Header items stagger
    if (headerRef.value) {
      tl.fromTo(
        headerRef.value.querySelectorAll('.anim-item'),
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.08 },
        '-=0.2'
      )
    }

    // Form column slides in from right
    if (formRef.value) {
      tl.fromTo(
        formRef.value,
        { opacity: 0, x: 30 },
        { opacity: 1, x: 0, duration: 0.4 },
        '-=0.1'
      )
    }

    // Products column slides in from left
    if (productsContainerRef.value) {
      tl.fromTo(
        productsContainerRef.value,
        { opacity: 0, x: -30 },
        { opacity: 1, x: 0, duration: 0.4 },
        '-=0.1'
      )
    }

    // Floating particles background
    gsap.to('.bg-particle', {
      y: -30,
      duration: 3 + Math.random() * 2,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      stagger: 0.3,
    })

    // ─── Parallax: header background image ───
    if (headerRef.value) {
      const bgImg = headerRef.value.querySelector('.parallax-header-bg')
      if (bgImg) {
        gsap.to(bgImg, {
          y: 30,
          scale: 1.1,
          ease: 'none',
          scrollTrigger: {
            trigger: headerRef.value,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1.2,
          },
        })
      }
    }
  })
})

onUnmounted(() => {
  if (verifyDebounce) clearTimeout(verifyDebounce)
  ScrollTrigger.getAll().forEach((st) => st.kill())
  gsap.killTweensOf('.bg-particle')
  gsap.killTweensOf('.product-card, .saved-chip, .result-accent-bar')
  stopMobilePolling()
})
</script>

<template>
  <div class="game-detail-root min-h-screen bg-[#1A1919] text-white">
    <div ref="pageRef" class="relative">
      <!-- Loading State -->
      <div v-if="gameStore.loading" class="max-w-[1500px] mx-auto px-4 py-8">
        <LoadingSkeleton variant="detail" :count="4" />
      </div>

      <!-- Error State -->
      <div v-else-if="gameStore.error" class="max-w-md mx-auto text-center py-20 px-4">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-900/30 text-red-500 mb-4 border border-red-500/20">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-gray-400 mb-4 text-sm">{{ gameStore.error }}</p>
        <button
          @click="gameStore.fetchProducts(gameCode)"
          class="px-5 py-2 rounded-xl bg-[#C70C00] hover:bg-[#E80F00] text-white font-bold text-sm transition-all"
        >
          {{ i18n.t('detail.tryAgain') }}
        </button>
      </div>

      <!-- Game Detail Content -->
      <template v-else-if="gameStore.selectedGame">
        <!-- ═══ TOP GAME BANNER & HERO ═══ -->
        <div ref="headerRef" class="relative w-full select-none">
          <div class="relative w-full overflow-hidden bg-gradient-to-b from-[#1A1919] to-[#2A2A2A] flex flex-col shadow-lg shadow-black/20">
            <!-- Parallax Cover Banner -->
            <div class="relative w-full h-48 sm:h-56 md:h-64 lg:h-72 bg-[#2A2A2A]">
              <!-- Back Button -->
              <button
                @click="router.back()"
                class="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 text-white text-xs font-semibold transition-all duration-200 cursor-pointer group"
              >
                <svg class="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>

              <!-- Wallet Balance Badge -->
              <div
                v-if="!balanceLoading"
                :title="`Wallet balance: $${walletBalance.toFixed(2)}`"
                :class="['absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] sm:text-xs font-bold backdrop-blur-md transition-all duration-300', balanceBadgeColors]"
              >
                <span :class="['w-1.5 h-1.5 rounded-full', balanceDotColors]"></span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="balanceIcon" />
                </svg>
                <span>{{ balanceLabel }}</span>
              </div>

              <!-- Cover image -->
              <img
                :alt="gameDisplayName"
                class="parallax-header-bg w-full h-full object-cover opacity-90"
                loading="eager"
                :src="gameImageUrl"
              />
              <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#1A1919]/85"></div>
            </div>

            <!-- Game Info Header Details -->
            <div class="w-full max-w-[1500px] mx-auto px-3 sm:px-6 py-4 relative z-10">
              <div class="flex items-start gap-4 sm:gap-5">
                <!-- Avatar / Logo -->
                <div class="flex-shrink-0">
                  <img
                    :alt="gameDisplayName"
                    class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl object-cover border-2 border-[#3A3A3A] shadow-xl bg-[#2A2A2A]"
                    :src="gameImageUrl"
                  />
                </div>

                <!-- Info Column -->
                <div class="flex-grow text-left">
                  <div class="flex flex-wrap items-center gap-2">
                    <h1 class="text-white text-base uppercase sm:text-2xl md:text-3xl font-bold tracking-wide leading-tight drop-shadow-lg">
                      {{ gameDisplayName }}
                    </h1>
                    <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-sm">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span class="font-bold uppercase tracking-wider">
                        {{ playerNickname || 'VIDTOPUP' }}
                      </span>
                      <div class="flex items-center ml-0.5">
                        <img alt="KH flag" class="w-[16px] h-[11px] object-cover inline-block align-middle rounded-[2px] shadow-sm border border-[#3A3A3A]/30" src="https://flagcdn.com/w20/kh.png">
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 mt-2">
                    <div class="group inline-flex items-center gap-1 text-gray-300 text-[11px] font-semibold bg-[#2A2A2A] px-2.5 py-1 rounded-lg border border-[#3A3A3A] hover:border-[#C70C00]/40 transition-all duration-300">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" class="text-gray-400 group-hover:text-[#C70C00] transition-colors"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"></path></svg>
                      <span>Global</span>
                    </div>
                    <div class="group inline-flex items-center gap-1 text-gray-300 text-[11px] font-medium bg-[#2A2A2A] px-2.5 py-1 rounded-lg border border-[#3A3A3A] hover:border-[#C70C00]/40 transition-all duration-300">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" class="text-gray-400 group-hover:text-[#C70C00] transition-colors"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 11h-2V7h2v6zm0 4h-2v-2h2v2z"></path></svg>
                      <span>Instant Delivery</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Note -->
              <div class="flex items-start gap-2 text-[10px] sm:text-xs text-gray-400 border-t border-[#3A3A3A] pt-3 mt-4">
                <span class="mt-0.5 flex-shrink-0">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400 flex-shrink-0"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>
                </span>
                <p class="leading-normal"><span class="font-bold text-gray-300">Important Note:</span> Incorrect Player IDs may result in failed delivery pipeline parameters.</p>
              </div>
            </div>

            <!-- Marquee Ticker -->
            <div class="relative w-full flex items-center overflow-hidden bg-[#2A2A2A] border-t border-[#3A3A3A]" style="height: 36px;">
              <div class="flex whitespace-nowrap ticker-track">
                <span class="flex items-center gap-4 px-3 text-[11px] font-normal">
                  <span class="relative inline-flex items-center font-bold text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-md text-white overflow-hidden">
                    <span class="absolute inset-0 bg-gradient-to-r from-[#C70C00] to-[#E80F00]"></span>
                    <span class="relative">Platform</span>
                  </span>
                  <span class="truncate text-gray-300 max-w-[400px] sm:max-w-none font-medium">VIDTOPUP is a trusted gaming top-up platform with partnerships with 30+ game companies worldwide, providing safe, fast, and convenient recharge for millions of players.</span>
                  <span class="text-[#3A3A3A] mx-2">•</span>
                </span>
                <span class="flex items-center gap-4 px-3 text-[11px] font-normal">
                  <span class="relative inline-flex items-center font-bold text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-md text-white overflow-hidden">
                    <span class="absolute inset-0 bg-gradient-to-r from-[#C70C00] to-[#E80F00]"></span>
                    <span class="relative">Instant</span>
                  </span>
                  <span class="truncate text-gray-300 max-w-[400px] sm:max-w-none font-medium">Instant automated delivery 24/7. Verified player name check powered by official game API.</span>
                  <span class="text-[#3A3A3A] mx-2">•</span>
                </span>
                <span class="flex items-center gap-4 px-3 text-[11px] font-normal">
                  <span class="relative inline-flex items-center font-bold text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-md text-white overflow-hidden">
                    <span class="absolute inset-0 bg-gradient-to-r from-[#C70C00] to-[#E80F00]"></span>
                    <span class="relative">Platform</span>
                  </span>
                  <span class="truncate text-gray-300 max-w-[400px] sm:max-w-none font-medium">VIDTOPUP is a trusted gaming top-up platform with partnerships with 30+ game companies worldwide, providing safe, fast, and convenient recharge for millions of players.</span>
                  <span class="text-[#3A3A3A] mx-2">•</span>
                </span>
                <span class="flex items-center gap-4 px-3 text-[11px] font-normal">
                  <span class="relative inline-flex items-center font-bold text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-md text-white overflow-hidden">
                    <span class="absolute inset-0 bg-gradient-to-r from-[#C70C00] to-[#E80F00]"></span>
                    <span class="relative">Instant</span>
                  </span>
                  <span class="truncate text-gray-300 max-w-[400px] sm:max-w-none font-medium">Instant automated delivery 24/7. Verified player name check powered by official game API.</span>
                  <span class="text-[#3A3A3A] mx-2">•</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ MOBILE ONLY: Account Info Card (Under Hero) ═══ -->
        <div class="block lg:hidden mt-3 px-2">
          <div class="bg-gradient-to-br from-[#1A1919] to-[#2A2A2A] border border-[#3A3A3A] rounded-2xl px-3 py-4 max-w-md mx-auto shadow-2xl">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-md bg-[#2A2A2A] border border-[#3A3A3A] flex items-center justify-center text-white shadow-sm">
                  <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="currentColor"><path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6"></path></svg>
                </div>
                <h2 class="text-xs font-bold tracking-wide text-gray-300 uppercase">Account Info</h2>
              </div>
              <button
                type="button"
                @click="showServerIdHelp = !showServerIdHelp"
                class="text-gray-500 transition-all duration-200 outline-none hover:text-[#C70C00] cursor-pointer"
                title="Can't find your ID?"
                aria-label="Can't find your ID?"
              >
                <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"></path>
                  <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.326 0-2.786.647-2.754 2.533m1.562 5.516c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.01.388-1.01.94"></path>
                </svg>
              </button>
            </div>

            <div class="space-y-1">
              <div :class="['overflow-hidden transition-all duration-300 ease-in-out', showServerIdHelp ? 'max-h-60 opacity-100 mb-3' : 'max-h-0 opacity-0 pointer-events-none']">
                <div class="bg-[#2A2A2A] border border-[#3A3A3A] rounded-2xl p-3 space-y-2">
                  <ol class="text-[11px] text-gray-400 space-y-1 list-decimal pl-4 font-medium">
                    <li>Open the game application</li>
                    <li>Tap your profile picture/avatar</li>
                    <li>Copy your User ID and Zone ID</li>
                  </ol>
                </div>
              </div>

              <div class="space-y-3">
                <div class="grid gap-3" :class="needsServerId ? 'grid-cols-3' : 'grid-cols-1'">
                  <div :class="needsServerId ? 'col-span-2' : 'col-span-1'" class="relative">
                    <label class="absolute -top-2 left-3 bg-[#1A1919] px-1.5 text-[9px] font-bold text-gray-400 uppercase z-10 tracking-wider rounded-sm">Game ID</label>
                    <input
                      v-model="playerId"
                      autocomplete="off"
                      class="w-full bg-[#2A2A2A] border rounded-xl px-3 py-2 text-sm text-white font-semibold outline-none transition-all"
                      :class="verified ? 'border-[#C70C00]/60 bg-[#C70C00]/10' : 'border-[#3A3A3A] focus:border-[#C70C00]/60'"
                      placeholder="Enter game ID"
                      type="text"
                      :disabled="verifying"
                    />
                  </div>
                  <div v-if="needsServerId" class="col-span-1 relative">
                    <label class="absolute -top-2 left-3 bg-[#1A1919] px-1.5 text-[9px] font-bold text-gray-400 uppercase z-10 tracking-wider rounded-sm">Zone ID</label>
                    <input
                      v-model="serverId"
                      inputmode="numeric"
                      class="w-full bg-[#2A2A2A] border rounded-xl px-3 py-2 text-sm text-white font-semibold outline-none transition-all"
                      :class="verified ? 'border-[#C70C00]/60 bg-[#C70C00]/10' : 'border-[#3A3A3A] focus:border-[#C70C00]/60'"
                      placeholder="Zone ID"
                      type="text"
                      :disabled="verifying"
                    />
                  </div>
                </div>

                <div v-if="verified && playerNickname" class="flex items-center gap-1.5 px-1">
                  <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Username:</span>
                  <span class="text-xs font-bold text-emerald-400">{{ playerNickname }}</span>
                  <div class="flex items-center ml-0.5">
                    <img alt="KH flag" class="w-[18px] h-[13px] object-cover inline-block align-middle rounded-[2px] shadow-sm border border-[#3A3A3A]/30" src="https://flagcdn.com/w20/kh.png">
                  </div>
                </div>

                <!-- Saved Chips Mobile -->
                <div v-if="savedForGame.length > 0 && !verified" class="pt-1 flex flex-wrap gap-1.5">
                  <button
                    v-for="saved in savedForGame"
                    :key="saved.playerId + (saved.serverId || '')"
                    @click="selectSavedPlayer(saved)"
                    class="px-2.5 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#3A3A3A] border border-[#3A3A3A] text-left text-[11px] text-gray-300 flex items-center gap-1.5 transition-all"
                  >
                    <span class="font-bold text-white">{{ saved.nickname }}</span>
                    <span class="text-[10px] text-gray-500 font-mono">{{ saved.playerId }}</span>
                  </button>
                </div>
              </div>

              <!-- Status footer -->
              <div class="mt-4 pt-3 flex items-center justify-between border-t border-[#3A3A3A] px-0.5">
                <div class="flex items-center gap-1.5 truncate max-w-[70%]">
                  <span class="text-gray-400 font-bold text-[10px] flex-shrink-0 uppercase">Status:</span>
                  <span v-if="verifying" class="font-bold text-[11px] text-amber-400 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                    Checking...
                  </span>
                  <span v-else-if="verified" class="font-bold text-[11px] min-h-[15px] block truncate flex items-center gap-1 text-emerald-400">
                    <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"></path></svg>
                    <span class="text-emerald-400">Verified</span>
                  </span>
                  <span v-else-if="verifyError" class="font-bold text-[11px] text-red-400 truncate">
                    {{ verifyError }}
                  </span>
                  <span v-else class="text-gray-500 text-[11px]">Enter Game ID</span>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0" :class="canProceed ? 'text-emerald-400' : 'text-gray-500'">
                  <svg class="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"></path></svg>
                  <span class="font-bold uppercase text-[9px] tracking-wider">{{ canProceed ? 'Ready' : 'Pending' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ MAIN 3-COLUMN LAYOUT (lg:grid-cols-3) ═══ -->
        <div class="mx-auto max-w-[1500px] grid grid-cols-1 lg:grid-cols-3 gap-4 mt-3 px-2 sm:px-4">
          <!-- Left Packages Column (lg:col-span-2) -->
          <div ref="productsContainerRef" class="lg:col-span-2 space-y-3">
            <!-- Sort Filter Pills -->
            <div class="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
              <button
                v-for="opt in ([{ mode: 'default' as SortMode, label: 'Default' }, { mode: 'most-popular' as SortMode, label: 'Most Popular' }, { mode: 'best-value' as SortMode, label: 'Best Value' }, { mode: 'cheapest' as SortMode, label: 'Cheapest' }, { mode: 'price-high' as SortMode, label: 'Price: High to Low' }])"
                :key="opt.mode"
                @click="activeSort = opt.mode"
                :class="[
                  'shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border transition-all duration-200 cursor-pointer',
                  activeSort === opt.mode
                    ? 'bg-[#C70C00] text-white border-[#C70C00] shadow-sm'
                    : 'bg-[#2A2A2A] text-gray-400 border-[#3A3A3A] hover:border-[#C70C00]/50 hover:text-white'
                ]"
              >
                {{ opt.label }}
              </button>
            </div>

            <!-- Empty State -->
            <div v-if="gameStore.products.length === 0" class="text-center py-16 bg-[#2A2A2A] rounded-2xl border border-[#3A3A3A]">
              <p class="text-sm text-gray-400">No packages available yet</p>
            </div>

            <!-- Best Selling Section (if any) -->
            <div v-if="bestSellingProducts.length > 0" id="section-best-selling" class="mb-2">
              <div class="flex items-center gap-1.5 mb-2.5 p-2">
                <div class="w-1.5 h-3 rounded-full bg-[#C70C00]"></div>
                <h3 class="text-xs font-bold text-white uppercase tracking-wider">Best Selling</h3>
                <span class="text-[10px] font-bold text-gray-400 bg-[#C70C00]/10 border border-[#C70C00]/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  {{ bestSellingProducts.length }} items
                </span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                <ProductCard
                  v-for="product in bestSellingProducts"
                  :key="product.product_code"
                  :product="product"
                  :selected="selectedProduct?.product_code === product.product_code"
                  :game-code="gameCode"
                  :game-image-url="gameImageUrl"
                  :badge="productsNeedingBalanceCheck.has(product.product_code) ? 'balance-check' : productsWithPriceDrop.has(product.product_code) ? 'price-drop' : productsNeedingNewBadge.has(product.product_code) ? 'new' : (productBadges.get(product.product_code) || null)"
                  @select="selectProduct(product)"
                />
              </div>
            </div>

            <!-- General Packages Section -->
            <div id="section-general" class="mb-2">
              <div class="flex items-center gap-1.5 mb-2.5 p-2">
                <div class="w-1.5 h-3 rounded-full bg-[#C70C00]"></div>
                <h3 class="text-xs font-bold text-white uppercase tracking-wider">General</h3>
                <span class="text-[10px] font-bold text-gray-400 bg-[#C70C00]/10 border border-[#C70C00]/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  {{ generalProducts.length }} items
                </span>
              </div>
              <div ref="productsListRef" class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                <ProductCard
                  v-for="product in generalProducts"
                  :key="product.product_code"
                  :product="product"
                  :selected="selectedProduct?.product_code === product.product_code"
                  :game-code="gameCode"
                  :game-image-url="gameImageUrl"
                  :badge="productsNeedingBalanceCheck.has(product.product_code) ? 'balance-check' : productsWithPriceDrop.has(product.product_code) ? 'price-drop' : productsNeedingNewBadge.has(product.product_code) ? 'new' : (productBadges.get(product.product_code) || null)"
                  @select="selectProduct(product)"
                />
              </div>
            </div>
          </div>

          <!-- Right Sidebar Column (Desktop Sticky) -->
          <div ref="formRef" class="hidden lg:block lg:sticky lg:top-10 h-fit space-y-4">
            <!-- Desktop Account Info Card -->
            <div class="px-2 select-none">
              <div class="bg-gradient-to-br from-[#1A1919] to-[#2A2A2A] border border-[#3A3A3A] rounded-2xl px-3 py-4 shadow-2xl">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-md bg-[#2A2A2A] border border-[#3A3A3A] flex items-center justify-center text-white shadow-sm">
                      <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 16 16" fill="currentColor"><path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6"></path></svg>
                    </div>
                    <h2 class="text-xs font-bold tracking-wide text-gray-300 uppercase">Account Info</h2>
                  </div>
                  <button
                    type="button"
                    @click="showServerIdHelp = !showServerIdHelp"
                    class="text-gray-500 transition-all duration-200 outline-none hover:text-[#C70C00] cursor-pointer"
                    title="Can't find your ID?"
                    aria-label="Can't find your ID?"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"></path>
                      <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.326 0-2.786.647-2.754 2.533m1.562 5.516c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.01.388-1.01.94"></path>
                    </svg>
                  </button>
                </div>

                <div class="space-y-1">
                  <!-- Help Drawer -->
                  <div :class="['overflow-hidden transition-all duration-300 ease-in-out', showServerIdHelp ? 'max-h-60 opacity-100 mb-3' : 'max-h-0 opacity-0 pointer-events-none']">
                    <div class="bg-[#2A2A2A] border border-[#3A3A3A] rounded-2xl p-3 space-y-2">
                      <ol class="text-[11px] text-gray-400 space-y-1 list-decimal pl-4 font-medium">
                        <li>Open the game application</li>
                        <li>Tap your profile picture/avatar</li>
                        <li>Copy your User ID and Zone ID</li>
                      </ol>
                    </div>
                  </div>

                  <div class="space-y-3">
                    <div class="grid gap-3" :class="needsServerId ? 'grid-cols-3' : 'grid-cols-1'">
                      <div :class="needsServerId ? 'col-span-2' : 'col-span-1'" class="relative">
                        <label class="absolute -top-2 left-3 bg-[#1A1919] px-1.5 text-[9px] font-bold text-gray-400 uppercase z-10 tracking-wider rounded-sm">Game ID</label>
                        <input
                          v-model="playerId"
                          autocomplete="off"
                          class="w-full bg-[#2A2A2A] border rounded-xl px-3 py-2 text-sm text-white font-semibold outline-none transition-all"
                          :class="verified ? 'border-[#C70C00]/60 bg-[#C70C00]/10' : 'border-[#3A3A3A] focus:border-[#C70C00]/60'"
                          placeholder="Enter game ID"
                          type="text"
                          :disabled="verifying"
                        />
                      </div>
                      <div v-if="needsServerId" class="col-span-1 relative">
                        <label class="absolute -top-2 left-3 bg-[#1A1919] px-1.5 text-[9px] font-bold text-gray-400 uppercase z-10 tracking-wider rounded-sm">Zone ID</label>
                        <input
                          v-model="serverId"
                          inputmode="numeric"
                          class="w-full bg-[#2A2A2A] border rounded-xl px-3 py-2 text-sm text-white font-semibold outline-none transition-all"
                          :class="verified ? 'border-[#C70C00]/60 bg-[#C70C00]/10' : 'border-[#3A3A3A] focus:border-[#C70C00]/60'"
                          placeholder="Zone ID"
                          type="text"
                          :disabled="verifying"
                        />
                      </div>
                    </div>

                    <!-- Verified Nickname -->
                    <div v-if="verified && playerNickname" class="flex items-center gap-1.5 px-1">
                      <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Username:</span>
                      <span class="text-xs font-bold text-emerald-400">{{ playerNickname }}</span>
                      <div class="flex items-center ml-0.5">
                        <img alt="KH flag" class="w-[18px] h-[13px] object-cover inline-block align-middle rounded-[2px] shadow-sm border border-[#3A3A3A]/30" src="https://flagcdn.com/w20/kh.png">
                      </div>
                    </div>

                    <!-- Previously Verified Quick Chips -->
                    <div v-if="savedForGame.length > 0 && !verified" class="pt-1 flex flex-wrap gap-1.5">
                      <button
                        v-for="saved in savedForGame"
                        :key="saved.playerId + (saved.serverId || '')"
                        @click="selectSavedPlayer(saved)"
                        class="px-2.5 py-1 rounded-lg bg-[#2A2A2A] hover:bg-[#3A3A3A] border border-[#3A3A3A] text-left text-[11px] text-gray-300 flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <span class="font-bold text-white">{{ saved.nickname }}</span>
                        <span class="text-[10px] text-gray-500 font-mono">{{ saved.playerId }}</span>
                      </button>
                    </div>
                  </div>

                  <!-- Status footer -->
                  <div class="mt-4 pt-3 flex items-center justify-between border-t border-[#3A3A3A] px-0.5">
                    <div class="flex items-center gap-1.5 truncate max-w-[70%]">
                      <span class="text-gray-400 font-bold text-[10px] flex-shrink-0 uppercase">Status:</span>
                      <span v-if="verifying" class="font-bold text-[11px] text-amber-400 flex items-center gap-1">
                        <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        Checking...
                      </span>
                      <span v-else-if="verified" class="font-bold text-[11px] min-h-[15px] block truncate flex items-center gap-1 text-emerald-400">
                        <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zm-3.97-3.03a.75.75 0 0 0-1.08.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-.01-1.05z"></path></svg>
                        <span class="text-emerald-400">Verified</span>
                      </span>
                      <span v-else-if="verifyError" class="font-bold text-[11px] text-red-400 truncate">
                        {{ verifyError }}
                      </span>
                      <span v-else class="text-gray-500 text-[11px]">Enter Game ID</span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0" :class="canProceed ? 'text-emerald-400' : 'text-gray-500'">
                      <svg class="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"></path></svg>
                      <span class="font-bold uppercase text-[9px] tracking-wider">{{ canProceed ? 'Ready' : 'Pending' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Payment Method Card (Bakong / ABA KHQR) -->
            <div class="w-full select-none p-2 space-y-3">
              <div class="flex items-center justify-between px-0.5">
                <span class="text-white text-xs sm:text-sm font-bold uppercase tracking-wide">Payment Method</span>
                <span class="text-[11px] text-gray-400 font-medium flex items-center gap-1">
                  <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                  Secure Gateway
                </span>
              </div>
              <div class="relative group overflow-hidden rounded-2xl bg-[#2A2A2A] border border-[#C70C00]/50 p-3.5 flex items-center justify-between transition-all duration-200 shadow-lg">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 bg-[#C70C00]/10 blur-xl rounded-full pointer-events-none"></div>
                <div class="flex items-center gap-3 relative z-10">
                  <div class="h-12 w-12 flex flex-col items-center justify-center p-1 bg-[#1A1919] border border-[#3A3A3A] rounded-xl shadow-sm flex-shrink-0">
                    <img alt="KHQR" class="w-full h-full object-contain rounded-lg" src="/khqr.png">
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-white text-sm font-bold leading-tight">Bakong / ABA KHQR</span>
                    </div>
                    <p class="text-[11px] text-gray-400 font-medium mt-0.5">Scan to pay with any banking app</p>
                  </div>
                </div>
                <div class="w-4 h-4 rounded-full border-2 border-[#C70C00] flex items-center justify-center flex-shrink-0 bg-transparent">
                  <div class="w-2 h-2 rounded-full bg-[#C70C00]"></div>
                </div>
              </div>

              <!-- Desktop Pay Now Button -->
              <button
                v-if="canProceed"
                ref="proceedBtnRef"
                @click="handlePayNow"
                class="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#C70C00] to-[#E80F00] hover:from-[#E80F00] hover:to-[#C70C00] text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-[#C70C00]/30 transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <path d="M14 14h3v3h-3zM17 17h4v4h-4z" />
                </svg>
                <span>Pay Now • {{ formatPrice(selectedProduct?.sell_price || 0).formatted }}</span>
              </button>
              <button
                v-else
                disabled
                class="w-full py-3 px-4 rounded-xl bg-[#2A2A2A] border border-[#3A3A3A] text-gray-500 font-bold text-sm cursor-not-allowed text-center"
              >
                {{ !verified ? 'Enter & Verify Game ID' : 'Select a Package' }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══ Scroll-to-top button ═══ -->
    <Transition name="scroll-top">
      <button
        v-if="showScrollTop"
        @click="scrollToTop"
        :title="'Scroll to top'"
        class="fixed bottom-24 right-5 lg:bottom-8 lg:right-8 z-30 w-10 h-10 rounded-xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-lg hover:shadow-xl text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-300 dark:hover:border-primary-600 active:scale-90 transition-all duration-200 flex items-center justify-center"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
      </button>
    </Transition>

    <!-- ═══ Mobile Floating Checkout Bar (phone only — state-aware) ═══ -->
    <Transition name="float-bar">
      <div
        v-if="gameStore.selectedGame && !mobileCheckoutActive"
        class="fixed bottom-0 left-0 right-0 z-40 block lg:hidden safe-bottom"
      >
        <div class="absolute inset-0 bg-white/95 dark:bg-surface-900/95 backdrop-blur-xl border-t border-surface-200 dark:border-surface-700 shadow-2xl shadow-black/5"></div>
        <div class="relative flex items-center justify-between px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))]">
          <!-- Left: state message or total -->
          <div class="min-w-0 flex-1">
            <!-- Not verified yet -->
            <template v-if="!verified">
              <p class="text-[10px] text-surface-400 dark:text-surface-500 uppercase tracking-wider font-medium">Need to Verify</p>
              <p class="text-sm font-semibold text-surface-500 dark:text-surface-400 truncate flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Enter your Player ID first
              </p>
            </template>
            <!-- Verified but no package selected -->
            <template v-else-if="!selectedProduct">
              <p class="text-[10px] text-surface-400 dark:text-surface-500 uppercase tracking-wider font-medium">Almost Done</p>
              <p class="text-sm font-semibold text-primary-500 dark:text-primary-400 truncate flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Select a package below
              </p>
            </template>
            <!-- Verified + package selected: show package + total -->
            <template v-else>
              <div class="flex items-center gap-2 max-w-[200px] sm:max-w-xs">
                <img
                  v-if="selectedVisual"
                  :src="selectedVisual.imageUrl"
                  :alt="selectedVisual.displayTitle"
                  class="w-8 h-8 object-contain rounded-lg p-0.5 bg-surface-100 dark:bg-surface-800 shrink-0"
                  @error="(e: Event) => { (e.target as HTMLImageElement).src = gameImageUrl }"
                />
                <div class="min-w-0">
                  <p class="text-xs font-bold text-surface-900 dark:text-white truncate">
                    <template v-if="selectedVisual?.isPass">
                      {{ selectedVisual.displayTitle }}
                    </template>
                    <template v-else>
                      {{ selectedVisual?.displayTitle }} {{ selectedVisual?.displayCurrency }}
                    </template>
                  </p>
                  <p class="text-sm font-extrabold text-primary-600 dark:text-primary-400 leading-tight">
                    {{ formatPrice(selectedProduct.sell_price).formatted }}
                  </p>
                </div>
              </div>
            </template>
          </div>

          <!-- Right: action button -->
          <div class="shrink-0 ml-3">
            <button
              v-if="canProceed"
              @click="handlePayNow"
              class="px-6 py-2.5 bg-gradient-to-r from-red-600 to-[#e41e26] hover:from-red-700 hover:to-red-600 text-white font-bold rounded-2xl shadow-lg shadow-red-500/30 active:scale-[0.97] transition-all duration-200 text-sm flex items-center gap-2"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <path d="M14 14h3v3h-3zM17 17h4v4h-4z" />
              </svg>
              Pay Now
            </button>
            <button
              v-else
              :disabled="!verified"
              class="px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 flex items-center gap-1.5"
              :class="verified
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-400 dark:text-surface-500'
                : 'bg-primary-500/10 text-primary-500/70'
              "
            >
              <span>{{ verified ? 'Select Package' : 'Verify ID' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Spacer for mobile floating bar -->
    <div v-if="gameStore.selectedGame && !mobileCheckoutActive" class="h-20 lg:hidden"></div>

    <!-- ═══ KHQR Payment Modal Dialog (Responsive: Desktop & Mobile) ═══ -->
    <Teleport to="body">
      <!-- Backdrop with smooth fade transition -->
      <Transition name="khqr-backdrop">
        <div
          v-if="mobileCheckoutActive"
          key="backdrop"
          class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          @click="closeMobileCheckout"
        ></div>
      </Transition>

      <!-- Centered KHQR Modal Dialog -->
      <Transition name="khqr-modal">
        <div
          v-if="mobileCheckoutActive"
          key="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="khqr-dialog-title"
          class="fixed top-[50%] left-[50%] z-50 grid max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border duration-200 ease-out outline-none w-[calc(100%-2rem)] border-none bg-transparent p-0 shadow-none sm:max-w-[360px] pointer-events-auto"
          tabindex="-1"
          style="pointer-events: auto;"
        >
          <h2 id="khqr-dialog-title" class="text-lg leading-none font-semibold sr-only">Checkout</h2>

          <!-- Redesigned Clean KHQR Card -->
          <div class="mx-auto w-full max-w-[360px] overflow-hidden rounded-[2rem] bg-white font-sans shadow-2xl">
            
            <!-- Red Header with Close Button and KHQR Logo -->
            <div class="relative flex h-14 items-center justify-center px-6 bg-[#e41e26]">
              <button
                @click="closeMobileCheckout"
                aria-label="Close"
                class="absolute right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30 cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x h-4 w-4">
                  <path d="M18 6 6 18"></path>
                  <path d="m6 6 12 12"></path>
                </svg>
              </button>
              <img alt="KHQR" class="h-6 object-contain select-none" src="/khqr.png">
            </div>

            <!-- Receipt & Order Summary with Corner Fold -->
            <div class="relative border-b border-dashed border-gray-300 px-6 pt-4 pb-3">
              <div class="absolute -top-px right-0 h-0 w-0 border-t-[24px] border-l-[24px] border-l-transparent border-t-[#e41e26]" aria-hidden="true"></div>
              <div class="flex items-center gap-2.5">
                <img
                  v-if="selectedVisual"
                  :src="selectedVisual.imageUrl"
                  :alt="selectedVisual.displayTitle"
                  class="size-7 rounded-lg object-contain p-0.5 bg-slate-100 shrink-0"
                  @error="(e: Event) => { (e.target as HTMLImageElement).src = (gameStore.selectedGame?.image_url || '/logo.svg') }"
                />
                <img
                  v-else-if="gameStore.selectedGame?.image_url"
                  :src="gameStore.selectedGame.image_url"
                  :alt="gameDisplayName"
                  class="size-6 rounded-sm object-cover"
                />
                <img
                  v-else
                  alt=""
                  class="size-6 rounded-sm object-contain invert"
                  src="/logo.svg"
                />
                <div class="min-w-0">
                  <h3 class="text-sm font-bold text-slate-800 truncate">
                    {{ gameDisplayName }} · {{ selectedVisual?.isPass ? selectedVisual.displayTitle : `${selectedVisual?.displayTitle} ${selectedVisual?.displayCurrency}` }}
                  </h3>
                  <div v-if="selectedVisual?.subLabel" class="text-[10px] font-semibold text-emerald-600">
                    {{ selectedVisual.subLabel }}
                  </div>
                </div>
              </div>
              <div class="flex items-baseline gap-1.5 mt-1.5">
                <h2 class="text-2xl font-extrabold text-gray-900">
                  {{ formatPrice(selectedProduct?.sell_price || 0).formatted }}
                </h2>
                <span class="text-xs font-medium text-slate-500 uppercase">{{ formatPrice(selectedProduct?.sell_price || 0).code }}</span>
              </div>
              <div v-if="playerNickname || playerId" class="text-[11px] text-slate-500 truncate mt-0.5">
                Player: <span class="font-semibold text-slate-700">{{ playerNickname || playerId }}</span>
                <span v-if="serverId" class="ml-1 text-slate-400">({{ serverId }})</span>
              </div>
            </div>

            <!-- QR Code and Scanning Body -->
            <div class="flex min-h-[240px] flex-col items-center justify-center px-6 pb-8">
              <div class="flex w-full flex-col items-center">
                
                <!-- QR Code Box -->
                <div class="relative mt-5 aspect-square w-full flex items-center justify-center">
                  <!-- Loading State -->
                  <div v-if="mobileQrLoading" class="flex flex-col items-center justify-center py-10">
                    <svg class="w-10 h-10 text-[#e41e26] animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p class="text-xs text-gray-500 font-medium mt-3">Generating KHQR...</p>
                  </div>

                  <!-- Error State -->
                  <div v-else-if="mobileQrError" class="text-center py-6">
                    <p class="text-xs text-red-500 font-medium mb-3">{{ mobileQrError }}</p>
                    <button
                      @click="executePayNow"
                      class="px-4 py-1.5 bg-red-50 hover:bg-red-100 text-[#e41e26] font-medium text-xs rounded-full transition-colors"
                    >
                      Retry Payment
                    </button>
                  </div>

                  <!-- QR Code with Centered $ Badge -->
                  <template v-else-if="mobileQrImage">
                    <img
                      :src="mobileQrImage"
                      alt="KHQR Code"
                      class="w-full h-full object-contain rounded-lg"
                    />
                    <div class="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                      <div class="flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-gray-900 text-sm font-bold text-white shadow-md">
                        $
                      </div>
                    </div>
                  </template>
                </div>

                <!-- Expiration Countdown Pill -->
                <div
                  v-if="mobilePaymentStatus === 'pending' && mobileTimeLeft > 0"
                  class="mt-3 flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1"
                >
                  <div class="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500"></div>
                  <span class="text-xs font-medium text-gray-600">
                    Expires in {{ Math.floor(mobileTimeLeft / 60) }}:{{ String(mobileTimeLeft % 60).padStart(2, '0') }}
                  </span>
                </div>

                <!-- Instruction Subtitle -->
                <p class="mt-3 text-xs text-gray-400 text-center">Scan with any KHQR-enabled banking app</p>

                <!-- Deep Link Button (Mobile Phones Only, Hidden on Desktop) -->
                <a
                  v-if="mobileCheckoutUrl"
                  :href="mobileCheckoutUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-4 flex sm:hidden w-full items-center justify-center gap-2 rounded-xl bg-[#0d6087] py-3.5 text-sm font-semibold text-white transition hover:bg-[#0b5075] active:scale-[0.98] shadow-md shadow-[#0d6087]/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link h-4 w-4">
                    <path d="M15 3h6v6"></path>
                    <path d="M10 14 21 3"></path>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  </svg>
                  Open ABA App
                </a>

              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Success overlay (mobile) -->
    <Teleport to="body">
      <div
        v-if="mobilePaymentStatus === 'paid'"
        class="fixed inset-0 z-[60] flex items-center justify-center p-4 overflow-y-auto"
    >
      <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/90 via-emerald-600/85 to-teal-700/90 backdrop-blur-md"></div>
      <!-- Confetti particles -->
      <div class="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div
          v-for="i in 40" :key="i"
          class="absolute w-2.5 h-2.5 rounded-sm animate-confetti"
          :style="{
            left: `${Math.random() * 100}%`,
            top: `-${Math.random() * 20}%`,
            backgroundColor: ['#10B981', '#34D399', '#6EE7B7', '#FCD34D', '#F472B6', '#818CF8', '#FBBF24', '#F97316'][i % 8],
            animationDelay: `${Math.random() * 2.5}s`,
            animationDuration: `${2.5 + Math.random() * 2.5}s`,
            width: `${8 + Math.random() * 10}px`,
            height: `${8 + Math.random() * 10}px`,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          }"
        ></div>
      </div>
      <div class="relative text-center animate-scale-in">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mb-6 animate-bounce-in">
          <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
            <path class="animate-draw-check" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 class="text-2xl font-bold text-white mb-1">Payment Successful!</h2>
        <p class="text-emerald-100 text-sm">Redirecting to order details...</p>

        <!-- Receipt download (mobile) -->
        <div v-if="mobileOrderData" class="mt-6 max-w-sm mx-auto">
          <ReceiptCard
            :reference="mobileOrderData.reference"
            :game-name="mobileOrderData.game_name"
            :product-name="mobileOrderData.product_name"
            :player-id="mobileOrderData.player_id"
            :server-id="mobileOrderData.server_id"
            :amount="mobileOrderData.amount"
            :payment-status="mobileOrderData.payment_status"
            :order-status="mobileOrderData.order_status"
            :created-at="mobileOrderData.created_at"
            :completed-at="mobileOrderData.completed_at"
          />
        </div>
        <div v-else-if="mobileReceiptLoading" class="mt-6 flex justify-center">
          <svg class="w-6 h-6 text-white/60 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- ═══ Balance Eligibility Confirmation Dialog ═══ -->
    <Teleport to="body">
      <Transition name="balance-dialog">
        <div
          v-if="showBalanceDialog"
          class="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto"
          @keydown.escape="closeBalanceDialog"
        >
          <!-- Backdrop -->
          <div
            class="absolute inset-0 bg-black/50 backdrop-blur-sm"
            @click="closeBalanceDialog"
          ></div>
          <!-- Dialog card -->
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Balance eligibility confirmation"
            class="relative w-full max-w-md bg-white dark:bg-surface-900 rounded-2xl shadow-2xl border border-surface-200 dark:border-surface-700 overflow-hidden"
            @click.stop
          >
            <!-- Header accent bar -->
            <div class="h-1.5 bg-gradient-to-r from-amber-500 to-rose-500"></div>
            <div class="p-6 space-y-5">
              <!-- Warning icon + title -->
              <div class="flex items-start gap-4">
                <div class="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                  <svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-surface-900 dark:text-surface-100">
                    Balance Check Required
                  </h3>
                  <p class="text-sm text-surface-500 dark:text-surface-400 mt-1">
                    This "Less is More" package is only available for accounts with
                    <strong class="text-amber-600 dark:text-amber-400">49 💎 or fewer</strong> remaining diamonds.
                  </p>
                </div>
              </div>

              <!-- Details -->
              <div class="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl p-4 space-y-2">
                <div class="flex items-start gap-3">
                  <svg class="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p class="text-xs text-amber-700 dark:text-amber-300">
                    Bay2Game requires that the player's account has <strong>49 diamonds or fewer</strong> in their balance to be eligible for this package. If the balance is 50+ diamonds, the order may fail or the diamonds may not be delivered.
                  </p>
                </div>
                <div class="flex items-start gap-3">
                  <svg class="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p class="text-xs text-amber-700 dark:text-amber-300">
                    <strong>Please ask your customer</strong> to check their in-game diamond balance before proceeding. We cannot automatically verify the balance.
                  </p>
                </div>
              </div>

              <!-- Confirmation checkbox -->
              <label class="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  v-model="balanceConfirmed"
                  class="mt-0.5 w-4 h-4 rounded border-surface-300 dark:border-surface-600 text-primary-500 focus:ring-primary-400 cursor-pointer"
                />
                <span class="text-sm text-surface-700 dark:text-surface-300 group-hover:text-surface-900 dark:group-hover:text-surface-100 transition-colors">
                  I have confirmed with the customer that their account has <strong>49 💎 or fewer</strong> remaining diamonds.
                </span>
              </label>

              <!-- Action buttons -->
              <div class="flex items-center gap-3 pt-1">
                <button
                  @click="closeBalanceDialog"
                  class="flex-1 px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 text-sm font-semibold text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  @click="proceedWithBalanceCheck"
                  :disabled="!balanceConfirmed"
                  class="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-200"
                  :class="balanceConfirmed
                    ? 'bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 shadow-lg shadow-primary-500/20 active:scale-[0.98]'
                    : 'bg-surface-200 dark:bg-surface-700 text-surface-400 dark:text-surface-500 cursor-not-allowed'
                  "
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
.product-card {
  /* Initial state is set by GSAP; this ensures a static fallback */
  will-change: transform, opacity;
}

/* ─── Floating bar enter/leave transitions ─── */.float-bar-enter-active {
  transition: transform var(--anim-enter-duration) var(--anim-enter-ease),
               opacity var(--anim-enter-duration) var(--anim-enter-ease);
}

.float-bar-leave-active {
  transition: transform var(--anim-leave-duration) var(--anim-leave-ease),
               opacity var(--anim-leave-duration) var(--anim-leave-ease);
}

.float-bar-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.float-bar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

.float-bar-enter-to {
  transform: translateY(0);
  opacity: 1;
}

/* ─── Desktop proceed button slide-up ─── */.proceed-btn-enter-active {
  transition: transform var(--anim-enter-duration) var(--anim-enter-ease),
               opacity var(--anim-enter-duration) var(--anim-enter-ease);
}

.proceed-btn-leave-active {
  transition: transform var(--anim-leave-duration) var(--anim-leave-ease),
               opacity var(--anim-leave-duration) var(--anim-leave-ease);
}

.proceed-btn-enter-from {
  transform: translateY(12px);
  opacity: 0;
}

.proceed-btn-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}

.proceed-btn-enter-to {
  transform: translateY(0);
  opacity: 1;
}

/* ─── Verify result card pop-in animation (similar to checkmark pulse) ─── */
.result-card-enter-active {
  /* Delay 0.3s so checkmark pop settles first, then card enters */
  animation: card-pop 0.35s 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  opacity: 0;
}

@keyframes card-pop {
  0% {
    transform: translateY(-6px) scale(0.92);
    opacity: 0;
  }
  45% {
    transform: translateY(2px) scale(1.04);
    opacity: 1;
  }
  70% {
    transform: translateY(-1px) scale(0.97);
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}.result-card-leave-active {
  transition: transform var(--anim-leave-duration) var(--anim-leave-ease),
               opacity var(--anim-leave-duration) var(--anim-leave-ease);
}

.result-card-leave-to {
  transform: translateY(-8px) scale(0.97);
  opacity: 0;
}

/* ─── Verified checkmark pulse animation ─── */
@keyframes verified-pulse {
  0% {
    transform: scale(0) rotate(-15deg);
    opacity: 0;
  }
  40% {
    transform: scale(1.3) rotate(0deg);
    opacity: 1;
  }
  65% {
    transform: scale(0.88) rotate(0deg);
  }
  100% {
    transform: scale(1) rotate(0deg);
    opacity: 1;
  }
}

.verified-pulse {
  animation: verified-pulse 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  transform-origin: center;
  will-change: transform, opacity;
}

/* ─── Brief 'Verified!' toast that appears after checkmark settles ─── */
@keyframes toast-in {
  0% {
    opacity: 0;
    transform: translateY(4px) scale(0.9);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes toast-out {
  0% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translateY(-3px) scale(0.9);
  }
}

.verified-toast {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.5rem;
  margin-top: 2px;
  font-size: 0.65rem;
  font-weight: 600;
  line-height: 1.2;
  color: rgb(16, 185, 129);
  background: rgba(16, 185, 129, 0.1);
  border-radius: 9999px;
  /* Delay 0.7s so checkmark & result card settle first, stay ~2s, then fade out */
  animation: toast-in 0.3s 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards,
             toast-out 0.25s 3.0s ease-in forwards;
  pointer-events: none;
}

/* Dark mode: slightly brighter background so the pill is visible on surface-900 */
:is(.dark) .verified-toast {
  background: rgba(16, 185, 129, 0.2);
}

/* ─── Spinner → checkmark smooth swap transition ─── */
.status-swap-leave-active {
  transition: opacity 0.15s ease-in, transform 0.15s ease-in;
}

.status-swap-enter-active {
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
}

.status-swap-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.85);
}

.status-swap-enter-from {
  opacity: 0;
  transform: translateY(4px) scale(0.85);
}

/* ─── Verified green glow on input fields ─── */
@keyframes verified-glow {
  0% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0), 0 0 0 0 rgba(16, 185, 129, 0);
    border-color: rgba(16, 185, 129, 0.3);
  }
  40% {
    box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.25), 0 0 12px 0 rgba(16, 185, 129, 0.12);
    border-color: rgba(16, 185, 129, 0.6);
  }
  100% {
    box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.12), 0 0 8px 0 rgba(16, 185, 129, 0.06);
    border-color: rgba(16, 185, 129, 0.5);
  }
}

/* Smooth border/glow transitions on all input fields (in/out) */
.input-field {
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.input-field.input-verified {
  animation: verified-glow 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  border-color: rgba(16, 185, 129, 0.5);
}

.input-field.input-verified:focus {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2), 0 0 10px 0 rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.6);
}

/* ─── KHQR backdrop fade transition (unified 0.3s) ─── */
.khqr-backdrop-enter-active {
  transition: opacity var(--anim-backdrop-duration) ease-out;
}
.khqr-backdrop-leave-active {
  transition: opacity var(--anim-leave-duration) var(--anim-leave-ease);
}
.khqr-backdrop-enter-from,
.khqr-backdrop-leave-to {
  opacity: 0;
}
.khqr-backdrop-enter-to {
  opacity: 1;
}

/* ─── KHQR Centered Modal Transition (Smooth scale-fade) ─── */
.khqr-modal-enter-active {
  transition: opacity var(--anim-enter-duration, 0.3s) ease-out,
              transform var(--anim-enter-duration, 0.3s) cubic-bezier(0.16, 1, 0.3, 1);
}
.khqr-modal-leave-active {
  transition: opacity var(--anim-leave-duration, 0.2s) var(--anim-leave-ease, ease-in),
              transform var(--anim-leave-duration, 0.2s) ease-in;
}
.khqr-modal-enter-from,
.khqr-modal-leave-to {
  transform: translate(-50%, -48%) scale(0.95);
  opacity: 0;
}
.khqr-modal-enter-to,
.khqr-modal-leave-from {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}

/* ─── Balance confirmation dialog entrance/exit ─── */
.balance-dialog-enter-active {
  transition: opacity var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
.balance-dialog-leave-active {
  transition: opacity var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in);
}
.balance-dialog-enter-from,
.balance-dialog-leave-to {
  opacity: 0;
}
.balance-dialog-enter-active > div:last-child {
  animation: balance-card-enter var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1)) both;
}
.balance-dialog-leave-active > div:last-child {
  animation: balance-card-leave var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in) both;
}
@keyframes balance-card-enter {
  from {
    opacity: 0;
    transform: scale(0.92) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
@keyframes balance-card-leave {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(0.92) translateY(20px);
  }
}

/* ─── Scroll-to-top button entrance/exit ─── */
.scroll-top-enter-active {
  transition: opacity var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
.scroll-top-leave-active {
  transition: opacity var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in),
              transform var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in);
}
.scroll-top-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.85);
}
.scroll-top-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.85);
}

/* ─── Reset button entrance/exit ─── */
.reset-fade-enter-active {
  transition: opacity var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1)),
              transform var(--anim-enter-duration, 0.4s) var(--anim-enter-ease, cubic-bezier(0.16, 1, 0.3, 1));
}
.reset-fade-leave-active {
  transition: opacity var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in),
              transform var(--anim-leave-duration, 0.25s) var(--anim-leave-ease, ease-in);
}
.reset-fade-enter-from {
  opacity: 0;
  transform: scale(0.85) translateX(-8px);
}
.reset-fade-leave-to {
  opacity: 0;
  transform: scale(0.85) translateX(-8px);
}

/* ─── SysTopUp Live Marquee Ticker ─── */
@keyframes ticker {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}

.ticker-track {
  display: flex;
  width: max-content;
  animation: ticker 32s linear infinite running;
  will-change: transform;
}

.ticker-track:hover {
  animation-play-state: paused;
}
</style>
