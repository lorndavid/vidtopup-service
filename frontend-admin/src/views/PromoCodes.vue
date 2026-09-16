<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useToastStore } from '@/stores/toast'
import adminApi from '@/services/api'
import type { AdminPromoCode, CreatePromoPayload, DiscountType } from '@/types'
import { formatUSD } from '@/utils/formatters'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue'

const toast = useToastStore()
const promos = ref<AdminPromoCode[]>([])
const loading = ref(true)
const saving = ref(false)

// Modal state
const showModal = ref(false)
const editingId = ref<string | null>(null)
const formData = ref<CreatePromoPayload>({
  code: '',
  discount_type: 'fixed',
  discount_value: 0.5,
  max_discount_amount: undefined,
  min_spend: 0,
  start_date: '',
  end_date: '',
  usage_limit: undefined,
  is_active: true,
})

// Quick stats
const totalPromos = computed(() => promos.value.length)
const activePromos = computed(() => promos.value.filter((p) => p.is_active).length)
const totalUses = computed(() => promos.value.reduce((sum, p) => sum + (p.used_count || 0), 0))

async function fetchPromos() {
  loading.value = true
  try {
    const res = await adminApi.getPromos()
    promos.value = res.data || []
  } catch (err) {
    toast.error('Failed to load promo codes', err instanceof Error ? err.message : '')
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  editingId.value = null
  formData.value = {
    code: '',
    discount_type: 'fixed',
    discount_value: 0.5,
    max_discount_amount: undefined,
    min_spend: 0,
    start_date: '',
    end_date: '',
    usage_limit: undefined,
    is_active: true,
  }
  showModal.value = true
}

function openEditModal(promo: AdminPromoCode) {
  editingId.value = promo._id
  formData.value = {
    code: promo.code,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    max_discount_amount: promo.max_discount_amount,
    min_spend: promo.min_spend || 0,
    start_date: promo.start_date ? promo.start_date.split('T')[0] : '',
    end_date: promo.end_date ? promo.end_date.split('T')[0] : '',
    usage_limit: promo.usage_limit,
    is_active: promo.is_active,
  }
  showModal.value = true
}

async function savePromo() {
  if (!formData.value.code.trim()) {
    toast.error('Validation Error', 'Promo code cannot be empty')
    return
  }
  if (!formData.value.discount_value || formData.value.discount_value <= 0) {
    toast.error('Validation Error', 'Discount value must be greater than 0')
    return
  }
  if (formData.value.discount_type === 'percentage' && formData.value.discount_value > 100) {
    toast.error('Validation Error', 'Percentage discount cannot exceed 100%')
    return
  }

  saving.value = true
  try {
    const payload: CreatePromoPayload = {
      ...formData.value,
      code: formData.value.code.trim().toUpperCase(),
      discount_value: Number(formData.value.discount_value),
      max_discount_amount: formData.value.max_discount_amount ? Number(formData.value.max_discount_amount) : undefined,
      min_spend: formData.value.min_spend ? Number(formData.value.min_spend) : 0,
      usage_limit: formData.value.usage_limit ? Number(formData.value.usage_limit) : undefined,
      start_date: formData.value.start_date || undefined,
      end_date: formData.value.end_date || undefined,
    }

    if (editingId.value) {
      await adminApi.updatePromo(editingId.value, payload)
      toast.success('Promo Updated', `Promo code ${payload.code} has been updated`)
    } else {
      await adminApi.createPromo(payload)
      toast.success('Promo Created', `Promo code ${payload.code} has been created`)
    }
    showModal.value = false
    await fetchPromos()
  } catch (err) {
    toast.error('Save Failed', err instanceof Error ? err.message : '')
  } finally {
    saving.value = false
  }
}

async function togglePromo(promo: AdminPromoCode) {
  try {
    await adminApi.togglePromo(promo._id)
    promo.is_active = !promo.is_active
    toast.success(
      'Status Changed',
      `Promo code ${promo.code} is now ${promo.is_active ? 'Active' : 'Inactive'}`
    )
  } catch (err) {
    toast.error('Failed to toggle status', err instanceof Error ? err.message : '')
  }
}

async function deletePromo(promo: AdminPromoCode) {
  if (!confirm(`Are you sure you want to delete promo code "${promo.code}"?`)) {
    return
  }
  try {
    await adminApi.deletePromo(promo._id)
    promos.value = promos.value.filter((p) => p._id !== promo._id)
    toast.success('Promo Deleted', `Promo code ${promo.code} was removed`)
  } catch (err) {
    toast.error('Delete Failed', err instanceof Error ? err.message : '')
  }
}

function copyCode(code: string) {
  navigator.clipboard.writeText(code)
  toast.success('Copied', `Copied ${code} to clipboard`)
}

onMounted(fetchPromos)
</script>

<template>
  <div class="space-y-6">
    <!-- Top Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <span class="p-2 rounded-xl bg-primary-500/10 text-primary-500">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </span>
          Promo Codes &amp; Discounts CMS
        </h1>
        <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage customer discounts (Fixed Money amount or Percentage discount)
        </p>
      </div>

      <button
        @click="openCreateModal"
        class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold shadow-lg shadow-primary-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New Promo Code
      </button>
    </div>

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card p-4 flex items-center justify-between">
        <div>
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Promo Codes</p>
          <p class="text-2xl font-bold text-slate-900 dark:text-white mt-1">{{ totalPromos }}</p>
        </div>
        <div class="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
          #
        </div>
      </div>

      <div class="card p-4 flex items-center justify-between">
        <div>
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Campaigns</p>
          <p class="text-2xl font-bold text-emerald-500 mt-1">{{ activePromos }}</p>
        </div>
        <div class="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
          <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
        </div>
      </div>

      <div class="card p-4 flex items-center justify-between">
        <div>
          <p class="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Redemptions</p>
          <p class="text-2xl font-bold text-amber-500 mt-1">{{ totalUses }}</p>
        </div>
        <div class="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
          🎁
        </div>
      </div>
    </div>

    <!-- Table Container -->
    <div class="card overflow-hidden">
      <div v-if="loading" class="p-6">
        <LoadingSkeleton type="table" :rows="5" />
      </div>

      <div v-else-if="promos.length === 0" class="text-center py-12">
        <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-3">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </div>
        <p class="text-slate-600 dark:text-slate-300 font-medium">No promo codes yet</p>
        <p class="text-xs text-slate-400 mt-1">Create your first promo code to offer customer discounts</p>
        <button
          @click="openCreateModal"
          class="mt-4 px-4 py-2 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-500 transition-colors"
        >
          Create Promo Code
        </button>
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th class="py-3.5 px-4 font-semibold">Code</th>
              <th class="py-3.5 px-4 font-semibold">Type</th>
              <th class="py-3.5 px-4 font-semibold">Discount</th>
              <th class="py-3.5 px-4 font-semibold">Min Spend</th>
              <th class="py-3.5 px-4 font-semibold">Redemptions</th>
              <th class="py-3.5 px-4 font-semibold">Status</th>
              <th class="py-3.5 px-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
            <tr
              v-for="promo in promos"
              :key="promo._id"
              class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
            >
              <!-- Code -->
              <td class="py-3.5 px-4">
                <div class="flex items-center gap-2">
                  <span class="px-2.5 py-1 rounded-lg font-mono font-bold text-xs bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-700">
                    {{ promo.code }}
                  </span>
                  <button
                    @click="copyCode(promo.code)"
                    title="Copy code"
                    class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </td>

              <!-- Type Badge -->
              <td class="py-3.5 px-4">
                <span
                  v-if="promo.discount_type === 'percentage'"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400"
                >
                  <span>%</span> Percentage
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  <span>$</span> Fixed Money
                </span>
              </td>

              <!-- Discount Value -->
              <td class="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                <span v-if="promo.discount_type === 'percentage'">
                  {{ promo.discount_value }}% OFF
                  <span v-if="promo.max_discount_amount" class="text-xs text-slate-400 font-normal">
                    (Max ${{ promo.max_discount_amount }})
                  </span>
                </span>
                <span v-else>
                  -${{ Number(promo.discount_value).toFixed(2) }}
                </span>
              </td>

              <!-- Min Spend -->
              <td class="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                {{ promo.min_spend ? formatUSD(promo.min_spend) : 'No Min' }}
              </td>

              <!-- Uses / Limit -->
              <td class="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                <span class="font-medium text-slate-900 dark:text-white">{{ promo.used_count || 0 }}</span>
                <span class="text-slate-400"> / {{ promo.usage_limit || '∞' }}</span>
              </td>

              <!-- Status Toggle -->
              <td class="py-3.5 px-4">
                <button
                  @click="togglePromo(promo)"
                  :class="[
                    'px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors',
                    promo.is_active
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-500 hover:bg-slate-500/20'
                  ]"
                >
                  {{ promo.is_active ? 'Active' : 'Inactive' }}
                </button>
              </td>

              <!-- Actions -->
              <td class="py-3.5 px-4 text-right space-x-2">
                <button
                  @click="openEditModal(promo)"
                  class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium transition-colors"
                >
                  Edit
                </button>
                <button
                  @click="deletePromo(promo)"
                  class="px-2.5 py-1 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 text-xs font-medium transition-colors"
                >
                  Delete
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div class="card max-w-lg w-full p-6 space-y-5 bg-white dark:bg-[#131926] border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <h3 class="text-lg font-bold text-slate-900 dark:text-white">
            {{ editingId ? 'Edit Promo Code' : 'Create New Promo Code' }}
          </h3>
          <button
            @click="showModal = false"
            class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <form @submit.prevent="savePromo" class="space-y-4 text-left">
          <!-- Code -->
          <div>
            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Promo Code
            </label>
            <input
              v-model="formData.code"
              type="text"
              required
              placeholder="e.g. VIDTOPUP10 or SALE50"
              class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono uppercase font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <!-- Discount Type Selector -->
          <div>
            <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Discount Type
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label
                :class="[
                  'flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all',
                  formData.discount_type === 'fixed'
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                ]"
              >
                <input
                  type="radio"
                  v-model="formData.discount_type"
                  value="fixed"
                  class="hidden"
                />
                <span>💵 Fixed Money ($ USD)</span>
              </label>

              <label
                :class="[
                  'flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer transition-all',
                  formData.discount_type === 'percentage'
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400 font-bold'
                    : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                ]"
              >
                <input
                  type="radio"
                  v-model="formData.discount_type"
                  value="percentage"
                  class="hidden"
                />
                <span>% Percentage</span>
              </label>
            </div>
          </div>

          <!-- Discount Value & Max Cap -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                {{ formData.discount_type === 'percentage' ? 'Percentage (% off)' : 'Money Value ($ USD)' }}
              </label>
              <input
                v-model.number="formData.discount_value"
                type="number"
                step="0.01"
                min="0.01"
                required
                :placeholder="formData.discount_type === 'percentage' ? '10' : '0.50'"
                class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div v-if="formData.discount_type === 'percentage'">
              <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Max Discount Cap ($ USD)
              </label>
              <input
                v-model.number="formData.max_discount_amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Optional (e.g. 2.00)"
                class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div v-else>
              <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Min Spend ($ USD)
              </label>
              <input
                v-model.number="formData.min_spend"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00 (optional)"
                class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <!-- Usage Limit & Dates -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Usage Limit (Total uses)
              </label>
              <input
                v-model.number="formData.usage_limit"
                type="number"
                min="1"
                placeholder="Unlimited if blank"
                class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Expiration Date
              </label>
              <input
                v-model="formData.end_date"
                type="date"
                class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <!-- Active Toggle -->
          <div class="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="is_active"
              v-model="formData.is_active"
              class="w-4 h-4 rounded text-primary-600 focus:ring-primary-500 border-slate-300"
            />
            <label for="is_active" class="text-sm font-medium text-slate-700 dark:text-slate-300">
              Active (Customers can use this promo immediately)
            </label>
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              @click="showModal = false"
              class="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-bold shadow-md transition-all cursor-pointer"
            >
              {{ saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Promo' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
