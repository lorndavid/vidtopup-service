<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useGameStore } from '@/stores/game'
import { useI18nStore } from '@/stores/i18n'
import { useToastStore } from '@/stores/toast'
import ProductCard from '@/components/ProductCard.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import { verifyPlayer, createPayment, getPaymentStatus, cancelOrder, getOrder, getNewProductsConfig, getPriceDropsByGame, validatePromoCode } from '@/services/api'
import type { GameProduct, PromoValidationResult } from '@/types'
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

// ─── Promo Code State ───
const promoInput = ref('')
const appliedPromo = ref<PromoValidationResult | null>(null)
const promoLoading = ref(false)
const promoError = ref<string | null>(null)
const promoSuccess = ref<string | null>(null)

const finalPrice = computed(() => {
  if (!selectedProduct.value) return 0
  if (!appliedPromo.value) return selectedProduct.value.sell_price
  return appliedPromo.value.final_amount
})

const discountAmount = computed(() => {
  if (!selectedProduct.value || !appliedPromo.value) return 0
  return appliedPromo.value.discount_amount
})

async function applyPromo() {
  const code = promoInput.value.trim()
  if (!code) return
  if (!selectedProduct.value) {
    promoError.value = 'Please select a package first'
    return
  }

  promoLoading.value = true
  promoError.value = null
  promoSuccess.value = null

  try {
    const result = await validatePromoCode(
      code,
      selectedProduct.value.sell_price,
      gameCode.value
    )
    appliedPromo.value = result
    promoSuccess.value = result.message
    toast.success(result.message)
  } catch (err: any) {
    promoError.value = err.message || 'Invalid promo code'
    appliedPromo.value = null
  } finally {
    promoLoading.value = false
  }
}

function removePromo() {
  appliedPromo.value = null
  promoInput.value = ''
  promoError.value = null
  promoSuccess.value = null
}

// Re-validate applied promo when selected product changes
watch(selectedProduct, async (newProd) => {
  if (appliedPromo.value && newProd) {
    try {
      const result = await validatePromoCode(
        appliedPromo.value.code,
        newProd.sell_price,
        gameCode.value
      )
      appliedPromo.value = result
    } catch {
      appliedPromo.value = null
      promoError.value = 'Promo code not applicable to this package'
    }
  }
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
    amount: finalPrice.value,
    playerId: playerId.value.trim(),
    serverId: serverId.value.trim() || undefined,
    verifyProvider: verifyProvider.value || undefined,
  })

  if (!gameStore.currentOrder) return

  analytics.trackPayment('initiated', {
    game_code: gameCode.value,
    product_code: selectedProduct.value.product_code,
    amount: finalPrice.value,
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
      promo_code: appliedPromo.value ? appliedPromo.value.code : undefined,
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
  <div class="game-detail-root min-h-screen bg-[#0B0F17] text-slate-100 selection:bg-[#FF385C]/30 selection:text-white">
    <!-- Ambient Atmospheric Glows -->
    <div class="fixed inset-0 pointer-events-none overflow-hidden z-0">
      <div class="absolute -top-32 -right-32 w-[550px] h-[550px] bg-[#FF385C]/8 rounded-full blur-[140px]"></div>
      <div class="absolute top-1/3 -left-32 w-[450px] h-[450px] bg-blue-600/5 rounded-full blur-[130px]"></div>
    </div>

    <div ref="pageRef" class="relative z-10">
      <!-- Loading State -->
      <div v-if="gameStore.loading" class="max-w-[1440px] mx-auto px-4 py-8">
        <LoadingSkeleton variant="detail" :count="4" />
      </div>

      <!-- Error State -->
      <div v-else-if="gameStore.error" class="max-w-md mx-auto text-center py-20 px-4">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 text-red-400 mb-4 border border-red-500/20 shadow-lg shadow-red-500/10">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p class="text-slate-400 mb-4 text-sm">{{ gameStore.error }}</p>
        <button
          @click="gameStore.fetchProducts(gameCode)"
          class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] hover:from-[#FF4B6E] hover:to-[#FF6E4D] text-white font-bold text-sm shadow-lg shadow-[#FF385C]/25 transition-all"
        >
          {{ i18n.t('detail.tryAgain') }}
        </button>
      </div>

      <!-- Game Detail Content -->
      <template v-else-if="gameStore.selectedGame">
        <!-- ═══ TOP HERO SECTION ═══ -->
        <div class="max-w-[1440px] mx-auto px-3 sm:px-6 pt-3 sm:pt-4">
          <!-- Breadcrumb & Back -->
          <div class="flex items-center justify-between mb-3">
            <button
              @click="router.back()"
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#151C28]/80 hover:bg-[#1C2536] border border-[#232D42] text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer group"
            >
              <svg class="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform text-[#FF385C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Games</span>
            </button>

            <!-- Wallet Balance Pill -->
            <div
              v-if="!balanceLoading"
              :title="`Wallet balance: $${walletBalance.toFixed(2)}`"
              :class="['inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold backdrop-blur-md transition-all', balanceBadgeColors]"
            >
              <span :class="['w-1.5 h-1.5 rounded-full', balanceDotColors]"></span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="balanceIcon" />
              </svg>
              <span>{{ balanceLabel }}</span>
            </div>
          </div>

          <!-- Hero Banner Card -->
          <div class="relative rounded-3xl overflow-hidden border border-[#232D42] bg-gradient-to-b from-[#151C28] to-[#0E1422] shadow-2xl shadow-black/50">
            <!-- Cover image backdrop with cinematic gradient overlay -->
            <div class="relative w-full h-36 sm:h-48 md:h-56 overflow-hidden">
              <img
                :alt="gameDisplayName"
                class="w-full h-full object-cover object-center filter brightness-[0.75]"
                loading="eager"
                :src="gameImageUrl"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-[#0E1422] via-[#0E1422]/60 to-transparent"></div>
            </div>

            <!-- Banner info strip -->
            <div class="relative px-4 sm:px-6 pb-4 sm:pb-5 -mt-12 sm:-mt-16 flex flex-col sm:flex-row sm:items-end justify-between gap-4 z-10">
              <div class="flex items-end gap-3.5 sm:gap-5">
                <div class="relative shrink-0">
                  <img
                    :alt="gameDisplayName"
                    class="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl object-cover border-2 border-[#232D42] ring-2 ring-[#FF385C]/30 shadow-2xl bg-[#151C28]"
                    :src="gameImageUrl"
                  />
                  <span class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-[#0B0F17]">
                    <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                </div>

                <div class="text-left min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h1 class="text-lg sm:text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-tight">
                      {{ gameDisplayName }}
                    </h1>
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FF385C]/15 text-[#FF385C] border border-[#FF385C]/30">
                      Official Partner
                    </span>
                  </div>
                  <p class="text-xs sm:text-sm text-slate-400 mt-1 line-clamp-1">
                    {{ gameStore.selectedGame?.description || 'Fast, automated 24/7 diamond and currency recharge with official player verification.' }}
                  </p>
                </div>
              </div>

              <!-- Value highlights -->
              <div class="flex items-center gap-2 flex-wrap">
                <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#151C28]/90 border border-[#232D42] text-slate-300 text-xs font-medium">
                  <svg class="w-3.5 h-3.5 text-[#FF385C] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Instant Auto-Recharge</span>
                </div>
                <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#151C28]/90 border border-[#232D42] text-slate-300 text-xs font-medium">
                  <svg class="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>Direct Game API</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ═══ MAIN STEP-BY-STEP LAYOUT ═══ -->
        <div class="max-w-[1440px] mx-auto px-3 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          <!-- LEFT COLUMN (Steps 1 & 2): 8 columns on desktop -->
          <div class="lg:col-span-8 space-y-6">
            
            <!-- STEP 1: ACCOUNT INFORMATION CARD -->
            <div class="rounded-3xl p-4 sm:p-6 bg-[#131926]/90 border border-[#232D42] shadow-xl relative overflow-hidden">
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2.5">
                  <span class="w-7 h-7 rounded-xl bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-[#FF385C]/30">
                    1
                  </span>
                  <div>
                    <h2 class="text-sm sm:text-base font-bold text-white tracking-tight">Account Information</h2>
                    <p class="text-[11px] text-slate-400">Enter your game ID for automatic nickname check</p>
                  </div>
                </div>

                <!-- Help Toggle Button -->
                <button
                  type="button"
                  @click="showServerIdHelp = !showServerIdHelp"
                  class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#1B2334] hover:bg-[#232D42] border border-[#2B374E] text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 text-[#FF385C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>How to find ID?</span>
                </button>
              </div>

              <!-- Expandable ID Guide -->
              <div :class="['overflow-hidden transition-all duration-300 ease-in-out', showServerIdHelp ? 'max-h-60 opacity-100 mb-4' : 'max-h-0 opacity-0 pointer-events-none']">
                <div class="p-3.5 rounded-2xl bg-[#0B0F17]/80 border border-[#232D42] text-xs text-slate-300 space-y-2">
                  <p class="font-bold text-white flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Finding your ID in {{ gameDisplayName }}:</span>
                  </p>
                  <ol class="list-decimal pl-5 space-y-1 text-slate-400">
                    <li>Launch {{ gameDisplayName }} on your device.</li>
                    <li>Tap on your user avatar or profile icon in the top-left corner.</li>
                    <li>Your <strong>User ID</strong> (and Zone/Server ID in brackets) is displayed on your profile card.</li>
                  </ol>
                </div>
              </div>

              <!-- Inputs -->
              <div class="grid gap-3" :class="needsServerId ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'">
                <div :class="needsServerId ? 'sm:col-span-2' : 'col-span-1'">
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                    Player ID / User ID <span class="text-[#FF385C]">*</span>
                  </label>
                  <div class="relative">
                    <input
                      v-model="playerId"
                      autocomplete="off"
                      type="text"
                      placeholder="e.g. 12345678"
                      :disabled="verifying"
                      class="w-full bg-[#151C28] border rounded-xl px-3.5 py-2.5 text-sm text-white font-medium placeholder-slate-500 outline-none transition-all duration-200"
                      :class="verified ? 'border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30' : 'border-[#232D42] focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C]/40'"
                    />
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <svg v-if="verifying" class="w-4 h-4 animate-spin text-[#FF385C]" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span v-else-if="verified" class="text-emerald-400 flex items-center gap-1 text-xs font-bold">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>

                <div v-if="needsServerId">
                  <label class="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                    Zone / Server ID <span class="text-[#FF385C]">*</span>
                  </label>
                  <input
                    v-model="serverId"
                    inputmode="numeric"
                    type="text"
                    placeholder="e.g. 2001"
                    :disabled="verifying"
                    class="w-full bg-[#151C28] border rounded-xl px-3.5 py-2.5 text-sm text-white font-medium placeholder-slate-500 outline-none transition-all duration-200"
                    :class="verified ? 'border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30' : 'border-[#232D42] focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C]/40'"
                  />
                </div>
              </div>

              <!-- Verified Nickname Banner -->
              <div v-if="verified && playerNickname" class="mt-3.5 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <p class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Account Verified</p>
                    <p class="text-sm font-bold text-white truncate">{{ playerNickname }}</p>
                  </div>
                </div>
                <span v-if="playerRegion" class="text-xs font-semibold text-slate-400 bg-[#0B0F17]/60 px-2.5 py-1 rounded-lg">
                  {{ playerRegion }}
                </span>
              </div>

              <!-- Verification Error message -->
              <div v-else-if="verifyError" class="mt-3 p-3 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center justify-between">
                <span class="truncate">{{ verifyError }}</span>
                <button @click="handleVerify" class="underline font-bold text-red-300 ml-2 shrink-0">Retry</button>
              </div>

              <!-- Quick Saved Accounts -->
              <div v-if="savedForGame.length > 0 && !verified" class="mt-3 pt-3 border-t border-[#1F293D] flex items-center gap-2 flex-wrap">
                <span class="text-[11px] text-slate-400 font-medium">Recent:</span>
                <button
                  v-for="saved in savedForGame"
                  :key="saved.playerId + (saved.serverId || '')"
                  @click="selectSavedPlayer(saved)"
                  class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#151C28] hover:bg-[#1C2536] border border-[#232D42] text-xs text-slate-300 transition-all cursor-pointer"
                >
                  <span class="font-bold text-white">{{ saved.nickname }}</span>
                  <span class="text-[10px] text-slate-500 font-mono">({{ saved.playerId }})</span>
                </button>
              </div>
            </div>

            <!-- STEP 2: SELECT RECHARGE PACKAGE -->
            <div ref="productsContainerRef" class="rounded-3xl p-4 sm:p-6 bg-[#131926]/90 border border-[#232D42] shadow-xl space-y-4">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="flex items-center gap-2.5">
                  <span class="w-7 h-7 rounded-xl bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-[#FF385C]/30">
                    2
                  </span>
                  <div>
                    <h2 class="text-sm sm:text-base font-bold text-white tracking-tight">Select Package</h2>
                    <p class="text-[11px] text-slate-400">Choose diamond denominations or event passes</p>
                  </div>
                </div>

                <!-- Sort / Filter Pills -->
                <div class="flex items-center gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                  <button
                    v-for="opt in ([{ mode: 'default' as SortMode, label: 'All' }, { mode: 'most-popular' as SortMode, label: 'Popular' }, { mode: 'best-value' as SortMode, label: 'Best Value' }, { mode: 'cheapest' as SortMode, label: 'Lowest Price' }])"
                    :key="opt.mode"
                    @click="activeSort = opt.mode"
                    :class="[
                      'shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200 cursor-pointer',
                      activeSort === opt.mode
                        ? 'bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] text-white shadow-md shadow-[#FF385C]/25'
                        : 'bg-[#151C28] text-slate-400 hover:text-white border border-[#232D42] hover:border-[#FF385C]/40'
                    ]"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <!-- Best Selling / Featured Passes Section -->
              <div v-if="bestSellingProducts.length > 0 && activeSort === 'default'" class="space-y-2.5">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-[#FF385C]"></span>
                  <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">Recommended & Passes</h3>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
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

              <!-- General Denominations Section -->
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                    <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      {{ activeSort === 'default' ? 'Diamond Denominations' : 'All Packages' }}
                    </h3>
                  </div>
                  <span class="text-xs text-slate-400 font-mono font-medium">
                    {{ activeSort === 'default' ? generalProducts.length : sortedProducts.length }} items
                  </span>
                </div>

                <div ref="productsListRef" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                  <ProductCard
                    v-for="product in (activeSort === 'default' ? generalProducts : sortedProducts)"
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
          </div>

          <!-- RIGHT COLUMN (Sticky Order Summary on Desktop): 4 columns -->
          <div ref="formRef" class="hidden lg:block lg:col-span-4 sticky top-6 space-y-4">
            
            <!-- STEP 3: ORDER & PAYMENT SUMMARY -->
            <div class="rounded-3xl p-6 bg-[#131926]/95 border border-[#232D42] shadow-2xl space-y-5">
              <div class="flex items-center gap-2.5 pb-4 border-b border-[#1F293D]">
                <span class="w-7 h-7 rounded-xl bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] text-white font-extrabold text-xs flex items-center justify-center shadow-md shadow-[#FF385C]/30">
                  3
                </span>
                <div>
                  <h2 class="text-base font-bold text-white tracking-tight">Order Summary</h2>
                  <p class="text-[11px] text-slate-400">Review & Pay with Bakong KHQR</p>
                </div>
              </div>

              <!-- Selected Product Snapshot -->
              <div v-if="selectedProduct" class="p-3.5 rounded-2xl bg-[#0B0F17] border border-[#232D42] flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <img
                    v-if="selectedVisual"
                    :src="selectedVisual.imageUrl"
                    :alt="selectedVisual.displayTitle"
                    class="w-10 h-10 object-contain rounded-xl p-1 bg-[#151C28] shrink-0"
                    @error="(e: Event) => { (e.target as HTMLImageElement).src = gameImageUrl }"
                  />
                  <div class="min-w-0">
                    <p class="text-xs text-slate-400 font-medium">Selected Item</p>
                    <p class="text-sm font-bold text-white truncate">{{ selectedProduct.name }}</p>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <p class="text-base font-black text-amber-400 tabular-nums">
                    {{ formatPrice(selectedProduct.sell_price).formatted }}
                  </p>
                </div>
              </div>
              <div v-else class="p-4 rounded-2xl bg-[#0B0F17] border border-dashed border-[#232D42] text-center text-xs text-slate-500">
                Please select a recharge package
              </div>

              <!-- Verified Player Target -->
              <div class="space-y-2 text-xs">
                <div class="flex items-center justify-between text-slate-400">
                  <span>Player ID:</span>
                  <span class="font-mono text-white font-semibold">{{ playerId || 'Not entered' }}</span>
                </div>
                <div v-if="needsServerId && serverId" class="flex items-center justify-between text-slate-400">
                  <span>Zone ID:</span>
                  <span class="font-mono text-white font-semibold">{{ serverId }}</span>
                </div>
                <div class="flex items-center justify-between text-slate-400">
                  <span>Nickname:</span>
                  <span class="font-semibold text-emerald-400">{{ playerNickname || (verifying ? 'Verifying...' : 'Pending verification') }}</span>
                </div>
              </div>

              <!-- ═══ Promo Code Section ═══ -->
              <div class="pt-2 border-t border-[#1F293D] space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5 text-[#FF385C]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Promo Code
                  </span>
                  <span v-if="appliedPromo" class="text-[11px] text-emerald-400 font-bold">
                    {{ appliedPromo.discount_type === 'percentage' ? `${appliedPromo.discount_value}% OFF` : `-$${appliedPromo.discount_amount.toFixed(2)}` }}
                  </span>
                </div>

                <!-- Input or Active Tag -->
                <div v-if="!appliedPromo" class="flex gap-2">
                  <input
                    v-model="promoInput"
                    @keydown.enter.prevent="applyPromo"
                    type="text"
                    placeholder="Enter discount code..."
                    class="flex-1 px-3 py-2 rounded-xl bg-[#0B0F17] border border-[#232D42] focus:border-[#FF385C] focus:ring-1 focus:ring-[#FF385C]/40 text-xs text-white uppercase font-mono tracking-wider outline-none placeholder-slate-600 transition-all"
                  />
                  <button
                    type="button"
                    @click="applyPromo"
                    :disabled="promoLoading || !promoInput.trim()"
                    class="px-3.5 py-2 rounded-xl bg-[#1F293D] hover:bg-[#FF385C] disabled:opacity-40 disabled:hover:bg-[#1F293D] text-white text-xs font-bold transition-all duration-200 cursor-pointer"
                  >
                    {{ promoLoading ? '...' : 'Apply' }}
                  </button>
                </div>

                <!-- Applied Promo Pill -->
                <div
                  v-else
                  class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs"
                >
                  <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] bg-emerald-500/20 text-emerald-400">
                      {{ appliedPromo.code }}
                    </span>
                    <span class="text-slate-300 font-medium">
                      {{ appliedPromo.discount_type === 'percentage' ? `${appliedPromo.discount_value}% off` : `-$${appliedPromo.discount_amount.toFixed(2)} off` }}
                    </span>
                  </div>
                  <button
                    type="button"
                    @click="removePromo"
                    class="text-slate-400 hover:text-red-400 font-bold p-1 text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>

                <!-- Promo Error / Success Notice -->
                <p v-if="promoError" class="text-[11px] text-red-400 font-medium pl-1 flex items-center gap-1">
                  <svg class="w-3 h-3 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{{ promoError }}</span>
                </p>
                <p v-else-if="promoSuccess && appliedPromo" class="text-[11px] text-emerald-400 font-medium pl-1 flex items-center gap-1">
                  <svg class="w-3 h-3 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{{ promoSuccess }}</span>
                </p>
              </div>

              <!-- Price Breakdown (if promo applied) -->
              <div v-if="appliedPromo && selectedProduct" class="p-3 rounded-xl bg-[#0B0F17] border border-[#232D42] space-y-1.5 text-xs">
                <div class="flex items-center justify-between text-slate-400">
                  <span>Package Price:</span>
                  <span class="font-mono text-slate-300">{{ formatPrice(selectedProduct.sell_price).formatted }}</span>
                </div>
                <div class="flex items-center justify-between text-emerald-400 font-semibold">
                  <span>Promo Discount:</span>
                  <span class="font-mono">-{{ formatPrice(discountAmount).formatted }}</span>
                </div>
                <div class="flex items-center justify-between text-white font-extrabold pt-1 border-t border-[#1F293D]">
                  <span>Total Payable:</span>
                  <span class="font-mono text-amber-400 text-sm">{{ formatPrice(finalPrice).formatted }}</span>
                </div>
              </div>

              <!-- Payment Method Section -->
              <div class="space-y-2 pt-2 border-t border-[#1F293D]">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">Payment Method</span>
                  <span class="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                    <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                    </svg>
                    Zero Fee
                  </span>
                </div>

                <div class="p-3.5 rounded-2xl bg-[#0B0F17] border border-[#FF385C]/40 ring-1 ring-[#FF385C]/20 flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 p-1 flex items-center justify-center shrink-0">
                      <img src="/khqr.png" alt="KHQR" class="w-full h-full object-contain" />
                    </div>
                    <div>
                      <p class="text-sm font-bold text-white">Bakong KHQR</p>
                      <p class="text-[11px] text-slate-400">Scan with ABA, Wing, ACLEDA & all banks</p>
                    </div>
                  </div>
                  <div class="w-5 h-5 rounded-full border-2 border-[#FF385C] flex items-center justify-center">
                    <div class="w-2.5 h-2.5 rounded-full bg-[#FF385C]"></div>
                  </div>
                </div>
              </div>

              <!-- Pay Now CTA Button -->
              <button
                v-if="canProceed"
                ref="proceedBtnRef"
                @click="handlePayNow"
                class="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] hover:from-[#FF4B6E] hover:to-[#FF6E4D] text-white font-extrabold text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl shadow-[#FF385C]/30 hover:shadow-[#FF385C]/50 transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer"
              >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  <path d="M14 14h3v3h-3zM17 17h4v4h-4z" />
                </svg>
                <span>Pay Now • {{ formatPrice(finalPrice).formatted }}</span>
              </button>
              <button
                v-else
                disabled
                class="w-full py-3.5 px-4 rounded-2xl bg-[#182032] border border-[#232D42] text-slate-500 font-bold text-sm cursor-not-allowed text-center transition-all"
              >
                {{ !verified ? '1. Verify Player ID' : '2. Select a Package' }}
              </button>

              <p class="text-center text-[10px] text-slate-500 flex items-center justify-center gap-1">
                <svg class="w-3 h-3 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Safe & encrypted. By clicking Pay Now you accept VidTopUp terms.</span>
              </p>
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
                  <p class="text-sm font-extrabold text-primary-600 dark:text-primary-400 leading-tight flex items-center gap-1">
                    {{ formatPrice(finalPrice).formatted }}
                    <span v-if="appliedPromo" class="text-[10px] text-emerald-400 font-normal line-through">
                      {{ formatPrice(selectedProduct.sell_price).formatted }}
                    </span>
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
                  {{ formatPrice(finalPrice).formatted }}
                </h2>
                <span class="text-xs font-medium text-slate-500 uppercase">{{ formatPrice(finalPrice).code }}</span>
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
                    <strong class="text-amber-600 dark:text-amber-400">49 diamonds or fewer</strong> remaining diamonds.
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
                  I have confirmed with the customer that their account has <strong>49 diamonds or fewer</strong> remaining diamonds.
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
