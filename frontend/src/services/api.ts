import axios from 'axios'
import type {
  ApiResponse,
  GameCategory,
  CambodiaGamesResponse,
  ProductsResponse,
  PaymentRequest,
  PaymentResponse,
  PaymentStatus,
  OrderResponse,
  VerifyPlayerResult,
  CheckGameIdResponse,
  AdminDashboardData,
  BalanceInfo,
  NewProductsConfig,
  SiteAnnouncement,
  PromoValidationResult,
} from '@/types'

function getBaseUrl(): string {
  // If running in browser on vidtopup.store, use same-origin '/api' (proxied by Vercel edge)
  // or directly https://api.vidtopup.store/api
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.includes('vidtopup.store') || host.endsWith('.vercel.app')) {
      return '/api'
    }
  }

  const envUrl = import.meta.env.VITE_API_BASE_URL
  // Safety guard: if empty or pointing to the decommissioned lorndavid.online domain,
  // always use the active production VPS endpoint.
  if (!envUrl || envUrl.includes('lorndavid.online')) {
    return 'https://api.vidtopup.store/api'
  }
  const trimmed = envUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

import { incrementApiRequest, decrementApiRequest } from '@/stores/loading'

// ─── Request interceptor: track in-flight API calls for loading bar ──
api.interceptors.request.use(
  (config) => {
    incrementApiRequest()
    return config
  },
  (error) => {
    decrementApiRequest()
    return Promise.reject(error)
  }
)

// ─── Response interceptor: track in-flight API calls + error handling + fallback retry ──
api.interceptors.response.use(
  (response) => {
    decrementApiRequest()
    return response
  },
  async (error) => {
    decrementApiRequest()
    const originalRequest = error.config
    // If request failed on network error and hasn't retried yet, auto-retry with direct API
    if (originalRequest && !originalRequest.__isRetry && (!error.response || error.code === 'ERR_NETWORK')) {
      originalRequest.__isRetry = true
      if (originalRequest.baseURL === '/api') {
        originalRequest.baseURL = 'https://api.vidtopup.store/api'
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, 600))
        return await api(originalRequest)
      } catch {
        // Fall through to standard error handling
      }
    }
    if (error.response) {
      const message = error.response.data?.message || 'An error occurred'
      return Promise.reject(new Error(message))
    }
    if (error.request) {
      return Promise.reject(new Error('Network error. Please check your connection.'))
    }
    return Promise.reject(error)
  }
)

export async function getCategories(): Promise<GameCategory[]> {
  const { data } = await api.get<ApiResponse<GameCategory[]>>('/categories')
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to fetch categories')
  }
  return data.data
}

export async function getCambodiaGames(): Promise<CambodiaGamesResponse> {
  const { data } = await api.get<ApiResponse<CambodiaGamesResponse>>('/cambodia-games')
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to fetch Cambodia games')
  }
  return data.data
}

export async function getProducts(gameCode: string): Promise<ProductsResponse> {
  const { data } = await api.get<ApiResponse<ProductsResponse>>(`/products/${gameCode}`)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to fetch products')
  }
  return data.data
}

export async function createPayment(payload: PaymentRequest): Promise<PaymentResponse> {
  const { data } = await api.post<ApiResponse<PaymentResponse>>('/payment/create', payload)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to create payment')
  }
  return data.data
}

export async function getPaymentStatus(reference: string): Promise<PaymentStatus> {
  const { data } = await api.get<ApiResponse<PaymentStatus>>(`/payment/status/${reference}`)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to get payment status')
  }
  return data.data
}

export async function createOrder(params: {
  reference: string
  game_code: string
  product_code: string
  player_id: string
  server_id?: string
  amount: number
}): Promise<OrderResponse> {
  const { data } = await api.post<ApiResponse<OrderResponse>>('/order', params)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to create order')
  }
  return data.data
}

export async function verifyPlayer(params: {
  game_code: string
  player_id: string
  server_id?: string
}): Promise<VerifyPlayerResult> {
  const { data } = await api.post<ApiResponse<VerifyPlayerResult>>('/verify-player', params)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Player verification failed')
  }
  return data.data
}

export async function checkGameId(params: {
  game: string
  userid: string
  serverid?: string
}): Promise<CheckGameIdResponse> {
  const { data } = await api.get<CheckGameIdResponse>('/check-id', { params })
  return data
}

export async function getOrder(reference: string): Promise<OrderResponse> {
  const { data } = await api.get<ApiResponse<OrderResponse>>(`/order/${reference}`)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to get order')
  }
  return data.data
}

export async function cancelOrder(reference: string): Promise<{ success: boolean; message: string; reference: string }> {
  const { data } = await api.post<ApiResponse<{ success: boolean; message: string; reference: string }>>(`/order/${reference}/cancel`)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to cancel order')
  }
  return data.data
}

export async function retryOrder(reference: string): Promise<{
  success: boolean
  message: string
  awaiting_stock?: boolean
}> {
  const { data } = await api.post<ApiResponse<{ success: boolean; message: string; awaiting_stock?: boolean }>>(`/order/${reference}/retry`)
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to retry order')
  }
  return data.data
}

export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const { data } = await api.get<ApiResponse<AdminDashboardData>>('/admin/dashboard')
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to load admin dashboard')
  }
  return data.data
}

export async function getOrdersByPlayer(playerId: string): Promise<OrderResponse[]> {
  const { data } = await api.get<ApiResponse<OrderResponse[]>>(`/orders/player/${encodeURIComponent(playerId)}`)
  if (!data.success) {
    throw new Error(data.message || 'Failed to fetch orders')
  }
  return data.data || []
}

export async function getNewProductsConfig(): Promise<NewProductsConfig> {
  const { data } = await api.get<ApiResponse<NewProductsConfig>>('/config/new-products')
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to fetch new products config')
  }
  return data.data
}

export async function getPriceDropsByGame(gameCode: string): Promise<Record<string, number>> {
  const { data } = await api.get<ApiResponse<Record<string, number>>>(`/price-drops/${gameCode}`)
  if (!data.success || !data.data) {
    return {}
  }
  return data.data
}

export async function getResellerBalance(): Promise<BalanceInfo> {
  const { data } = await api.get<ApiResponse<BalanceInfo>>('/balance')
  if (!data.success || !data.data) {
    return { balance: 0, username: '', available: false }
  }
  return data.data
}

export async function getAnnouncements(): Promise<SiteAnnouncement[]> {
  const { data } = await api.get<ApiResponse<SiteAnnouncement[]>>('/announcements')
  if (!data.success) return []
  return data.data || []
}

export async function validatePromoCode(
  code: string,
  amount: number,
  gameCode: string
): Promise<PromoValidationResult> {
  const { data } = await api.post<ApiResponse<PromoValidationResult>>('/promos/validate', {
    code,
    amount,
    game_code: gameCode,
  })
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Invalid promo code')
  }
  return data.data
}

export default api
