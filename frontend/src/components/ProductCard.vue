<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { GameProduct } from '@/types'
import { useFormattedPrice } from '@/composables/useCurrency'
import { getPackageVisual } from '@/utils/packageVisuals'

type ProductBadge = 'best-value' | 'most-popular' | 'new' | 'price-drop' | 'balance-check' | null

const props = defineProps<{
  product: GameProduct
  selected?: boolean
  gameCode?: string
  gameImageUrl?: string
  badge?: ProductBadge
}>()

const emit = defineEmits<{
  select: []
}>()

const khrPrice = useFormattedPrice(props.product.sell_price)

const visual = computed(() =>
  getPackageVisual(props.gameCode || '', props.product.name, props.product.product_code)
)

const imageFailed = ref(false)
watch(
  () => visual.value.imageUrl,
  () => {
    imageFailed.value = false
  }
)

const iconSrc = computed(() => {
  if (imageFailed.value && props.gameImageUrl) {
    return props.gameImageUrl
  }
  return visual.value.imageUrl
})

function onImageError() {
  imageFailed.value = true
}
</script>

<template>
  <div
    @click="emit('select')"
    role="button"
    tabindex="0"
    :class="[
      'relative cursor-pointer select-none group rounded-2xl transition-all duration-200 package-card product-card flex items-center justify-between',
      'h-[76px] px-3.5 py-2.5',
      selected
        ? 'border-[#FF385C] bg-gradient-to-r from-[#FF385C]/15 via-[#1A2234] to-[#131926] ring-2 ring-[#FF385C]/40 shadow-[0_0_22px_rgba(255,56,92,0.22)] scale-[1.02]'
        : 'bg-[#131926]/90 border border-[#232D42] hover:border-[#FF385C]/60 hover:bg-[#182032] hover:shadow-[0_8px_20px_rgba(255,56,92,0.12)] hover:-translate-y-0.5'
    ]"
  >
    <!-- Selected Glowing Check Badge -->
    <div v-if="selected" class="check-badge absolute -top-1.5 -right-1.5 z-20 pointer-events-none">
      <div class="w-5 h-5 rounded-full bg-gradient-to-r from-[#FF385C] to-[#FF5E3A] flex items-center justify-center shadow-md shadow-[#FF385C]/40 ring-2 ring-[#0B0F17]">
        <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    </div>

    <!-- Optional Pill Badge on top-left (e.g. Best Value, New, Pass) -->
    <div
      v-if="badge || (visual.isPass && visual.passBadge)"
      class="absolute -top-2 left-2 z-10 pointer-events-none"
    >
      <span
        v-if="visual.isPass && visual.passBadge"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-extrabold tracking-wide uppercase text-white bg-gradient-to-r from-purple-600 to-pink-600 shadow-md shadow-purple-600/30 ring-1 ring-white/20"
      >
        {{ visual.passBadge }}
      </span>
      <span
        v-else-if="badge === 'best-value'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/20 ring-1 ring-white/20"
      >
        Best Value
      </span>
      <span
        v-else-if="badge === 'most-popular'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-md shadow-amber-500/20 ring-1 ring-white/20"
      >
        Popular
      </span>
      <span
        v-else-if="badge === 'price-drop'"
        class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-gradient-to-r from-rose-500 to-red-600 shadow-md shadow-rose-500/20 ring-1 ring-white/20"
      >
        Sale
      </span>
    </div>

    <!-- Text left: Amount / Title + Price -->
    <div class="text-left min-w-0 flex-1 pr-1.5">
      <p class="text-[13px] sm:text-sm font-bold text-white tracking-tight truncate leading-snug group-hover:text-white">
        <template v-if="visual.isPass">
          {{ visual.displayTitle }}
        </template>
        <template v-else>
          {{ visual.displayTitle }} {{ visual.displayCurrency }}
        </template>
      </p>
      <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">
        <p class="text-sm font-extrabold text-amber-400 tabular-nums drop-shadow-sm">
          {{ khrPrice.formatted }}
        </p>
        <span
          v-if="visual.subLabel"
          class="text-[9px] font-medium text-emerald-400 truncate max-w-[110px]"
        >
          {{ visual.subLabel }}
        </span>
      </div>
    </div>

    <!-- Right: Authentic package visual icon -->
    <div class="ml-1 sm:ml-2 flex-shrink-0">
      <img
        :src="iconSrc"
        :alt="visual.displayTitle"
        class="w-11 h-11 sm:w-12 sm:h-12 object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-110"
        loading="lazy"
        @error="onImageError"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes checkPop {
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.25); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.check-badge {
  animation: checkPop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
</style>
