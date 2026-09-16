/**
 * Admin Dashboard — TypeScript Type Definitions
 */

// ─── Admin Auth ───────────────────────────────────────
export interface AdminUser {
  id: string
  username: string
  role: 'admin' | 'superadmin'
  token: string
  loginMethod?: 'password' | 'apikey'
  apiKey?: string
  profile?: {
    balance: number
    totalOrders: number
    totalSpent: number
  }
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface ApiKeyCredentials {
  apiKey: string
}

export interface LoginResponse {
  success: boolean
  message: string
  data?: AdminUser
}

// ─── Dashboard Stats ──────────────────────────────────
export interface DashboardStats {
  total_orders: number
  total_revenue: number
  pending_revenue: number
  today_orders: number
  today_revenue: number
  active_users: number
  orders_by_status: {
    completed: number
    processing: number
    awaiting_stock: number
    failed: number
    cancelled: number
    pending: number
  }
  revenue_chart: {
    labels: string[]
    values: number[]
  }
}

export interface DashboardResponse {
  success: boolean
  message: string
  data: DashboardStats
}

// ─── Orders ────────────────────────────────────────────
export type OrderStatus = 'pending' | 'awaiting_payment' | 'paid' | 'processing' | 'awaiting_stock' | 'completed' | 'failed' | 'cancelled'

export interface AdminOrder {
  reference: string
  game_code: string
  game_name: string
  product_code: string
  product_name: string
  player_id: string
  server_id?: string
  amount: number
  cost_price?: number
  profit?: number
  payment_method: string
  payment_status: string
  order_status: OrderStatus
  retry_count: number
  next_retry_at?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface OrdersResponse {
  success: boolean
  message: string
  data: {
    orders: AdminOrder[]
    total: number
    page: number
    limit: number
    total_pages: number
  }
}

export interface UpdateOrderStatusPayload {
  status: OrderStatus
  note?: string
}

// ─── Products ──────────────────────────────────────────
export interface AdminProduct {
  id: number
  product_code: string
  name: string
  game_code: string
  game_name: string
  cost_price: number      // Bay2Game price (no markup)
  sell_price: number      // Current sell price (cost + profit)
  profit_amount: number   // Calculated profit
  profit_percent: number  // Calculated profit percentage
  status: string
  currency: string
  has_override?: boolean  // True if a custom sell price override exists in DB
}

export interface ProductsResponse {
  success: boolean
  message: string
  data: AdminProduct[]
}

// ─── Profit Margins ────────────────────────────────────
export interface ProfitMargin {
  game_code: string
  game_name: string
  type: 'percentage' | 'fixed'
  value: number           // If percentage: 10 = 10%, if fixed: 0.50 = $0.50
  min_profit?: number     // Minimum profit in USD
  max_profit?: number     // Maximum profit in USD (cap)
}

export interface ProfitMarginsResponse {
  success: boolean
  message: string
  data: ProfitMargin[]
}

export interface SaveProfitMarginPayload {
  game_code: string
  type: 'percentage' | 'fixed'
  value: number
  min_profit?: number
  max_profit?: number
}

// ─── Games / Categories ────────────────────────────────
export interface AdminGame {
  game_code: string
  name: string
  description: string
  image_url: string
  status: 'active' | 'inactive' | 'maintenance'
  total_products: number
  total_orders: number
  revenue: number
  profit_margin: ProfitMargin | null
}

export interface GamesResponse {
  success: boolean
  message: string
  data: AdminGame[]
}

// ─── Webhooks / Notifications ──────────────────────────
export interface WebhookEvent {
  id: string
  type: string
  data: Record<string, unknown>
  received_at: string
  processed: boolean
}

// ─── Analytics ────────────────────────────────────────
export interface AnalyticsDaily {
  date: string
  revenue: number
  orders: number
}

export interface AnalyticsByGame {
  game_code: string
  game_name: string
  revenue: number
  orders: number
}

export interface AnalyticsSummary {
  total_revenue: number
  total_orders: number
  period_revenue: number
  period_orders: number
  avg_order_value: number
}

export interface AnalyticsData {
  daily: AnalyticsDaily[]
  by_game: AnalyticsByGame[]
  summary: AnalyticsSummary
}

// ─── Announcements ─────────────────────────────────────
export interface Announcement {
  _id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'promo'
  is_active: boolean
  link_url?: string
  link_label?: string
  dismissible: boolean
  starts_at?: string
  expires_at?: string
  created_at: string
  updated_at: string
}

// ─── Page Analytics ───────────────────────────────────
export interface PageStatsOverview {
  total_page_views: number
  today_page_views: number
  weekly_page_views: number
  total_visitors: number
  today_visitors: number
}

export interface TopGameEntry {
  game_code: string
  count: number
}

export interface PageAnalyticsData {
  overview: PageStatsOverview
  top_games_clicked: TopGameEntry[]
  top_games_viewed: TopGameEntry[]
  daily_views: { date: string; count: number }[]
  conversions: {
    payment_initiated: number
    payment_completed: number
    payment_failed: number
  }
}

// ─── Promo Codes CMS ────────────────────────────────────
export type DiscountType = 'fixed' | 'percentage'

export interface AdminPromoCode {
  _id: string
  code: string
  discount_type: DiscountType
  discount_value: number
  max_discount_amount?: number
  min_spend?: number
  start_date?: string
  end_date?: string
  usage_limit?: number
  used_count: number
  is_active: boolean
  applicable_games?: string[]
  created_at: string
  updated_at: string
}

export interface CreatePromoPayload {
  code: string
  discount_type: DiscountType
  discount_value: number
  max_discount_amount?: number
  min_spend?: number
  start_date?: string
  end_date?: string
  usage_limit?: number
  applicable_games?: string[]
  is_active?: boolean
}

// ─── API Generic ───────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data?: T
  error?: string
}

// ─── Sidebar ──────────────────────────────────────────
export interface SidebarItem {
  label: string
  icon: string
  route?: string
  children?: SidebarChildItem[]
  badge?: string | number
}

export interface SidebarChildItem {
  label: string
  route: string
}
