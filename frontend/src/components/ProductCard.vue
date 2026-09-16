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
      'relative cursor-pointer transition-all rounded-2xl select-none group border package-card product-card',
      selected
        ? 'border-[#C70C00]/60 ring-1 ring-[#C70C00]/30 scale-[1.02] bg-[#2A2A2A]'
        : 'bg-[#2A2A2A] border-[#3A3A3A] hover:border-[#C70C00]/40 hover:bg-[#C70C00]/5'
    ]"
    style="height: 75px; padding: 0.5rem; display: flex; justify-content: space-between; align-items: center;"
  >
    <!-- Selected corner-mark check badge -->
    <div v-if="selected" class="corner-mark absolute top-0 right-0 z-20">
      <div class="w-6 h-6 bg-gradient-to-br from-[#C70C00] to-[#E80F00] rounded-tr-xl rounded-bl-lg flex items-center justify-center shadow-md">
        <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
    </div>

    <!-- Optional Ribbon Badge on top-left (e.g. Best Value, New, Pass) -->
    <div
      v-if="badge || (visual.isPass && visual.passBadge)"
      class="absolute -top-1.5 -left-1 z-10 pointer-events-none"
    >
      <span
        v-if="visual.isPass && visual.passBadge"
        class="inline-flex items-center px-1.5 py-0.2 rounded text-[8px] font-extrabold tracking-wider uppercase text-white bg-gradient-to-r from-[#C70C00] to-[#E80F00] shadow-sm"
      >
        {{ visual.passBadge }}
      </span>
      <span
        v-else-if="badge === 'best-value'"
        class="inline-flex items-center px-1.5 py-0.2 rounded text-[8px] font-bold text-white bg-emerald-600 shadow-sm"
      >
        Best Value
      </span>
      <span
        v-else-if="badge === 'most-popular'"
        class="inline-flex items-center px-1.5 py-0.2 rounded text-[8px] font-bold text-white bg-amber-600 shadow-sm"
      >
        Popular
      </span>
      <span
        v-else-if="badge === 'price-drop'"
        class="inline-flex items-center px-1.5 py-0.2 rounded text-[8px] font-bold text-white bg-red-600 shadow-sm"
      >
        Drop
      </span>
    </div>

    <!-- Text left: Amount / Title + Price -->
    <div class="text-left min-w-0 flex-1 pr-1">
      <p class="text-sm font-bold text-white truncate tracking-tight">
        <template v-if="visual.isPass">
          {{ visual.displayTitle }}
        </template>
        <template v-else>
          {{ visual.displayTitle }} {{ visual.displayCurrency }}
        </template>
      </p>
      <div class="flex items-center gap-1 mt-0.5 flex-wrap">
        <p class="text-sm font-bold text-amber-400 tabular-nums">{{ khrPrice.formatted }}</p>
        <span
          v-if="visual.subLabel"
          class="text-[9px] font-medium text-emerald-400 truncate max-w-[120px]"
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
        class="w-12 h-12 object-contain filter drop-shadow-sm transition-transform duration-200 group-hover:scale-105"
        loading="lazy"
        @error="onImageError"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes cornerPop { 
  0% { transform: scale(0) rotate(-45deg); opacity: 0; } 
  60% { transform: scale(1.2) rotate(0deg); opacity: 1; } 
  100% { transform: scale(1) rotate(0deg); opacity: 1; } 
}
.corner-mark {
  animation: cornerPop 0.3s ease forwards;
}
</style>
