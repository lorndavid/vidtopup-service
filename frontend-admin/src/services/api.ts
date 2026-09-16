import axios, { type AxiosInstance } from 'axios'
import type {
  ApiResponse,
  DashboardStats,
  AdminOrder,
  AdminProduct,
  ProfitMargin,
  AdminGame,
  Announcement,
  AnalyticsData,
  PageAnalyticsData,
  LoginCredentials,
  ApiKeyCredentials,
  LoginResponse,
  UpdateOrderStatusPayload,
  SaveProfitMarginPayload,
  AdminPromoCode,
  CreatePromoPayload,
} from '@/types'

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host.includes('vidtopup.store') || host.endsWith('.vercel.app')) {
      return '/api'
    }
  }

  const envUrl = import.meta.env.VITE_API_BASE_URL
  if (!envUrl || envUrl.includes('lorndavid.online')) {
    return 'https://api.vidtopup.store/api'
  }
  const trimmed = envUrl.replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

const API_BASE = getBaseUrl()

class AdminApiService {
  private api: AxiosInstance

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    })

    // Attach token from localStorage on every request
    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('admin_token')
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    })

    // Handle 401 — redirect to login
    this.api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          localStorage.removeItem('admin_token')
          window.location.href = '/login'
        }
        return Promise.reject(err)
      }
    )
  }

  // ─── Auth ─────────────────────────────────────
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const { data } = await this.api.post<LoginResponse>('/admin/login', credentials)
    return data
  }

  async loginWithApiKey(credentials: ApiKeyCredentials): Promise<LoginResponse> {
    const { data } = await this.api.post<LoginResponse>('/admin/login/apikey', credentials)
    return data
  }

  async logout(): Promise<void> {
    localStorage.removeItem('admin_token')
  }

  // ─── Dashboard ────────────────────────────────
  async getDashboard(): Promise<DashboardStats> {
    const { data } = await this.api.get<ApiResponse<DashboardStats>>('/admin/dashboard')
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to load dashboard')
    return data.data
  }

  // ─── Orders ───────────────────────────────────
  async getOrders(params?: {
    page?: number
    limit?: number
    status?: string
    game_code?: string
    search?: string
  }): Promise<{ orders: AdminOrder[]; total: number; page: number; limit: number; total_pages: number }> {
    const { data } = await this.api.get<ApiResponse<{ orders: AdminOrder[]; total: number; page: number; limit: number; total_pages: number }>>('/admin/orders', { params })
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch orders')
    return data.data
  }

  async updateOrderStatus(reference: string, payload: UpdateOrderStatusPayload): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>(`/admin/orders/${reference}/status`, payload)
    return data
  }

  // ─── Products ─────────────────────────────────
  async getProducts(gameCode?: string): Promise<AdminProduct[]> {
    const params = gameCode ? { game_code: gameCode } : {}
    const { data } = await this.api.get<ApiResponse<AdminProduct[]>>('/admin/products', { params })
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch products')
    return data.data
  }

  async updateProductProfit(productCode: string, sellPrice: number, gameCode?: string): Promise<ApiResponse> {
    const { data } = await this.api.put<ApiResponse>('/admin/products/profit', {
      product_code: productCode,
      sell_price: sellPrice,
      game_code: gameCode,
    })
    return data
  }

  async deleteProductOverride(productCode: string): Promise<ApiResponse> {
    const { data } = await this.api.delete<ApiResponse>(`/admin/products/override/${encodeURIComponent(productCode)}`)
    return data
  }

  // ─── Games ────────────────────────────────────
  async getGames(): Promise<AdminGame[]> {
    const { data } = await this.api.get<ApiResponse<AdminGame[]>>('/admin/games')
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch games')
    return data.data
  }

  // ─── Profit Margins ───────────────────────────
  async getProfitMargins(): Promise<ProfitMargin[]> {
    const { data } = await this.api.get<ApiResponse<ProfitMargin[]>>('/admin/profit-margins')
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch profit margins')
    return data.data
  }

  async saveProfitMargin(payload: SaveProfitMarginPayload): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/profit-margins', payload)
    return data
  }

  async saveProfitMargins(payloads: SaveProfitMarginPayload[]): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/profit-margins/batch', { margins: payloads })
    return data
  }

  // ─── Balance Alert ───────────────────────────────
  async getBalanceAlert(): Promise<{
    balance: number | null
    threshold: number
    isLow: boolean
    message: string
  }> {
    const { data } = await this.api.get<ApiResponse<{
      balance: number | null
      threshold: number
      isLow: boolean
      message: string
    }>>('/admin/balance-alert')
    if (!data.success || !data.data) {
      return { balance: null, threshold: 10, isLow: false, message: 'Balance check unavailable' }
    }
    return data.data
  }

  // ─── Funding History ────────────────────────────────
  async getFundingHistory(): Promise<ApiResponse> {
    const { data } = await this.api.get<ApiResponse>('/admin/funding-history')
    if (!data.success) throw new Error(data.message || 'Failed to fetch funding history')
    return data
  }

  // ─── Webhooks ───────────────────────────────────────
  async getWebhookConfig(): Promise<ApiResponse> {
    const { data } = await this.api.get<ApiResponse>('/admin/webhooks')
    if (!data.success) throw new Error(data.message || 'Failed to fetch webhook config')
    return data
  }

  async testWebhook(): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/webhooks/test')
    return data
  }

  // ─── Player ID Check ────────────────────────────────
  async checkPlayerId(params: {
    game: string
    userid: string
    serverid?: string
  }): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/check-player-id', params)
    return data
  }

  // ─── Direct Order ───────────────────────────────────
  async getDirectOrderGames(): Promise<ApiResponse> {
    const { data } = await this.api.get<ApiResponse>('/admin/direct-order/games')
    if (!data.success) throw new Error(data.message || 'Failed to fetch games')
    return data
  }

  async getDirectOrderProducts(gameCode: string): Promise<ApiResponse> {
    const { data } = await this.api.get<ApiResponse>(`/admin/direct-order/products/${gameCode}`)
    if (!data.success) throw new Error(data.message || 'Failed to fetch products')
    return data
  }    async createDirectOrder(params: {
    productCode: string
    gameUserId: string
    gameZoneId?: string
    reference: string
  }): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/direct-order/create', params)
    return data
  }

  // ─── Analytics ─────────────────────────────────
  async getAnalytics(period: number = 30): Promise<AnalyticsData> {
    const { data } = await this.api.get<ApiResponse<AnalyticsData>>('/admin/analytics', {
      params: { period },
    })
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch analytics')
    return data.data
  }

  async getPageAnalyticsStats(scope: 'all' | 'public' | 'admin' = 'all', period: number = 30): Promise<PageAnalyticsData> {
    const { data } = await this.api.get<ApiResponse<PageAnalyticsData>>('/admin/analytics/stats', {
      params: { scope, period },
    })
    if (!data.success || !data.data) throw new Error(data.message || 'Failed to fetch page analytics')
    return data.data
  }

  // ─── Announcements ───────────────────────────────
  async getAnnouncements(): Promise<ApiResponse<{ announcements: Announcement[] }>> {
    const { data } = await this.api.get<ApiResponse<{ announcements: Announcement[] }>>('/admin/announcements')
    if (!data.success) throw new Error(data.message || 'Failed to fetch announcements')
    return data
  }

  async createAnnouncement(payload: Partial<Announcement>): Promise<ApiResponse> {
    const { data } = await this.api.post<ApiResponse>('/admin/announcements', payload)
    return data
  }

  async updateAnnouncement(id: string, payload: Partial<Announcement>): Promise<ApiResponse> {
    const { data } = await this.api.put<ApiResponse>(`/admin/announcements/${id}`, payload)
    return data
  }

  async deleteAnnouncement(id: string): Promise<ApiResponse> {
    const { data } = await this.api.delete<ApiResponse>(`/admin/announcements/${id}`)
    return data
  }

  async toggleAnnouncement(id: string): Promise<ApiResponse> {
    const { data } = await this.api.patch<ApiResponse>(`/admin/announcements/${id}/toggle`)
    return data
  }

  // ─── Promo Codes CMS ───────────────────────────────
  async getPromos(): Promise<ApiResponse<AdminPromoCode[]>> {
    const { data } = await this.api.get<ApiResponse<AdminPromoCode[]>>('/admin/promos')
    if (!data.success) throw new Error(data.message || 'Failed to fetch promo codes')
    return data
  }

  async createPromo(payload: CreatePromoPayload): Promise<ApiResponse<AdminPromoCode>> {
    const { data } = await this.api.post<ApiResponse<AdminPromoCode>>('/admin/promos', payload)
    return data
  }

  async updatePromo(id: string, payload: Partial<CreatePromoPayload>): Promise<ApiResponse<AdminPromoCode>> {
    const { data } = await this.api.put<ApiResponse<AdminPromoCode>>(`/admin/promos/${id}`, payload)
    return data
  }

  async deletePromo(id: string): Promise<ApiResponse> {
    const { data } = await this.api.delete<ApiResponse>(`/admin/promos/${id}`)
    return data
  }

  async togglePromo(id: string): Promise<ApiResponse<AdminPromoCode>> {
    const { data } = await this.api.patch<ApiResponse<AdminPromoCode>>(`/admin/promos/${id}/toggle`)
    return data
  }
}

export const adminApi = new AdminApiService()
export default adminApi
