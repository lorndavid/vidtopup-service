<script setup lang="ts">
import type { GameCategory } from '@/types'

defineProps<{
  game: GameCategory
}>()
</script>

<template>
  <router-link
    :to="`/game/${game.game_code}`"
    class="group relative cursor-pointer rounded-2xl overflow-hidden bg-[#131926]/90 border border-[#232D42] hover:border-[#FF385C]/60 transition-all duration-300 hover:shadow-[0_10px_25px_rgba(255,56,92,0.18)] hover:-translate-y-1 block select-none"
  >
    <!-- Image -->
    <div class="aspect-[4/3] overflow-hidden bg-[#0B0F17] relative">
      <img
        :src="game.image_url"
        :alt="game.name"
        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-[#0B0F17]/80 via-transparent to-transparent"></div>
    </div>

    <!-- Game Name -->
    <div class="p-2.5 sm:p-3 bg-[#131926]/90">
      <p class="text-xs sm:text-sm font-bold text-white truncate group-hover:text-[#FF385C] transition-colors duration-200">
        {{ game.name }}
      </p>
      <div class="flex items-center gap-1.5 mt-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-[10px] font-medium text-slate-400">Instant Delivery</span>
      </div>
    </div>
  </router-link>
</template>
