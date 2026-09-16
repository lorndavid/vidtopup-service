<script setup lang="ts">
import type { GameCategory } from '@/types'

defineProps<{
  game: GameCategory
}>()
</script>

<template>
  <router-link
    :to="`/game/${game.game_code}`"
    class="group relative cursor-pointer rounded-2xl overflow-hidden bg-[#2A2A2A] border border-[#3A3A3A] hover:border-[#C70C00]/60 transition-all duration-300 hover:shadow-xl hover:shadow-black/40 hover:-translate-y-1 block select-none"
  >
    <!-- Image -->
    <div class="aspect-[4/3] overflow-hidden bg-[#1A1919] relative">
      <img
        :src="game.image_url"
        :alt="game.name"
        class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        loading="lazy"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-[#1A1919]/80 via-transparent to-transparent"></div>
    </div>

    <!-- Game Name -->
    <div class="p-2.5 sm:p-3 bg-[#2A2A2A]">
      <p class="text-xs sm:text-sm font-bold text-white truncate group-hover:text-[#E80F00] transition-colors duration-200">
        {{ game.name }}
      </p>
      <div class="flex items-center gap-1.5 mt-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        <span class="text-[10px] font-medium text-gray-400">Instant Delivery</span>
      </div>
    </div>
  </router-link>
</template>
