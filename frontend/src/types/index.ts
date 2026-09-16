export interface GameCategory {
  game_code: string
  name: string
  description: string
  image_url: string
  game_fields: string[]
}

export interface GameProduct {
  id: number
  product_code: string
  name: string
  sell_price: number
  status: string
}

export interface GameDetail {
  game_code: string
  name: string
  description: string
  image_url: string
}

export interface ProductsResponse {
  game: GameDetail
  products: GameProduct[]
}

export interface PaymentRequest {
  game_code: string
  product_code: string
  product_name: string
  game_name: string
  player_id: string
  server_id?: string
  amount: number
  promo_code?: string
}

export interface PromoValidationResult {
  code: string
  discount_type: 'fixed' | 'percentage'
  discount_value: number
  discount_amount: number
  final_amount: number
  original_amount: number
  message: string
}

export interface PaymentResponse {
  reference: string
  amount: number
  khqr_image?: string
  khqr_data?: string
  checkout_url?: string
  cutluy_payment_id?: string
  expires_at: string
}

// Response shape from GET /api/cambodia-games
export interface CambodiaGamesResponse {
  featured: GameCategory[]
  others: GameCategory[]
  total: number
}

export interface BalanceInfo {
  balance: number
  username: string
  available: boolean
}

export interface PaymentStatus {
  reference: string
  /** 'scanned' is a non-terminal CutLuy hint — the QR was scanned, awaiting in-app confirmation */
  payment_status: 'pending' | 'scanned' | 'paid' | 'failed'
  order_status: string
}

export interface OrderResponse {
  reference: string
  game_code: string
  product_code: string
  product_name: string
  game_name: string
  player_id: string
  server_id?: string
  amount: number
  payment_method: string
  payment_status: string
  order_status: string
  retry_count?: number
  next_retry_at?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data?: T
  error?: string
}

export interface VerifyPlayerResult {
  verified: boolean
  nickname?: string
  playerId: string
  serverId?: string
  region?: string
  gameTitle?: string
  provider?: string
}

export interface CheckGameIdResponse {
  success: boolean
  message: string
  data?: {
    status: string
    username?: string
    region?: string
    game_title?: string
    timestamp?: string
    developer?: string
  }
}

export interface OrderSummary {
  gameName: string
  gameCode: string
  productName: string
  productCode: string
  amount: number
  playerId: string
  serverId?: string
  verifyProvider?: string
}

export interface AdminDashboardProfile {
  username: string
  balance: number
  total_orders: number
  total_spent: number
}

export interface AdminDashboardStats {
  total_orders: number
  awaiting_stock: number
  completed: number
  failed: number
  awaiting_payment: number
  processing: number
  cancelled: number
  total_revenue: number
  pending_revenue: number
}

export interface AwaitingStockOrder {
  reference: string
  game_code: string
  product_name: string
  game_name: string
  player_id: string
  server_id?: string
  amount: number
  retry_count: number
  next_retry_at: string | null
  created_at: string
  updated_at: string
}

export interface NewProductsConfig {
  [gameCode: string]: number[]
}

export interface AdminDashboardData {
  profile: AdminDashboardProfile | null
  stats: AdminDashboardStats
  awaiting_stock_orders: AwaitingStockOrder[]
}

export interface SiteAnnouncement {
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
}
