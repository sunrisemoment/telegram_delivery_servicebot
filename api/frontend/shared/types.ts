export type MiniAppRole = 'customer' | 'driver';

export interface DashboardStats {
  total_orders: number;
  total_revenue: number;
  active_customers: number;
  pending_orders: number;
  completed_orders: number;
}

export interface InviteSummary {
  id: number;
  code: string;
  alias_username?: string | null;
  alias_email?: string | null;
  target_role: MiniAppRole;
  notes?: string | null;
  status: string;
  claimed_by_customer_id?: number | null;
  claimed_by_telegram_id?: number | null;
  claimed_at?: string | null;
  created_at?: string | null;
  revoked_at?: string | null;
}

export interface DriverSummary {
  id: number;
  telegram_id: number;
  name: string;
  active: boolean;
  is_online: boolean;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  max_delivery_distance_miles: number;
  max_concurrent_orders: number;
  delivered_orders: number;
  active_orders: number;
  pickup_address?: {
    id: number;
    name: string;
    address: string;
  } | null;
  created_at?: string | null;
}

export interface CustomerSummary {
  id: number;
  telegram_id: number;
  phone?: string | null;
  display_name?: string | null;
  alias_username?: string | null;
  alias_email?: string | null;
  app_role?: MiniAppRole | null;
  account_status?: string | null;
  invite_code?: string | null;
  order_count?: number;
  created_at?: string | null;
  last_order_date?: string | null;
  last_login_at?: string | null;
}

export interface OrderSummary {
  id?: number;
  order_number: string;
  customer_telegram_id?: number | null;
  driver_name?: string | null;
  items: Array<{
    menu_id: number;
    name: string;
    quantity: number;
    price_cents: number;
  }>;
  total_cents: number;
  subtotal_cents?: number;
  delivery_fee_cents?: number;
  delivery_or_pickup: string;
  status: string;
  payment_type: string;
  payment_status: string;
  payment_confirmed: boolean;
  payment_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  delivery_slot_et?: string | null;
}

export interface OrderDetail {
  order_number: string;
  customer?: {
    telegram_id?: number | null;
    phone?: string | null;
  } | null;
  driver?: {
    name: string;
    telegram_id?: number | null;
  } | null;
  items: OrderSummary['items'];
  subtotal: number;
  subtotal_cents: number;
  delivery_type: string;
  delivery_fee: number;
  delivery_fee_cents: number;
  delivery_address?: string | null;
  pickup_address?: string | null;
  total: number;
  total_cents: number;
  status: string;
  payment_status: string;
  payment_confirmed: boolean;
  payment_type: string;
  delivery_slot?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface PickupAddressSummary {
  id: number;
  name: string;
  address: string;
  instructions?: string | null;
  active: boolean;
  created_at?: string | null;
}

export interface AdminMenuItem {
  id: number;
  category: string;
  name: string;
  description?: string | null;
  price_cents: number;
  price?: string | null;
  stock: number;
  active: boolean;
  photo_url?: string | null;
}

export interface InventoryReservationSummary {
  id: number;
  order_number: string;
  menu_item_name: string;
  reserved_qty: number;
  created_at?: string | null;
  expires_at?: string | null;
}

export interface DriverInventorySummary {
  menu_item_id: number;
  menu_item_name: string;
  category: string;
  on_hand_qty: number;
  updated_at?: string | null;
}

export interface ContactSettingsSummary {
  welcome_message: string;
  welcome_photo_url?: string | null;
  telegram_id?: number | null;
  telegram_username?: string | null;
  phone_number?: string | null;
  email_address?: string | null;
  additional_info?: string | null;
  last_updated?: string | null;
  updated_by?: number | null;
}

export interface BtcDiscountSettings {
  btc_discount_percent: number;
  updated_at?: string | null;
}

export interface PaymentSummary {
  order_number: string;
  customer_telegram_id?: number | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  payment_type: string;
  payment_status: string;
  payment_confirmed: boolean;
  payment_confirmed_by?: number | null;
  payment_confirmed_at?: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  delivery_type: string;
  created_at?: string | null;
  payment_metadata?: Record<string, unknown> | null;
}

export interface PaymentsListResponse {
  payments: PaymentSummary[];
  pagination: {
    skip: number;
    limit: number;
    total: number;
  };
  summary: {
    total_amount: number;
    total_count: number;
  };
}

export interface PaymentDetailSummary {
  order_number: string;
  payment_type: string;
  payment_status: string;
  payment_confirmed: boolean;
  payment_confirmed_by?: number | null;
  payment_confirmed_at?: string | null;
  subtotal: number;
  delivery_fee: number;
  total: number;
  customer_telegram_id?: number | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
}

export interface BtcStatusSummary {
  address?: string;
  confirmed_balance?: number;
  unconfirmed_balance?: number;
  total_received?: number;
  has_payment: boolean;
  has_unconfirmed: boolean;
  error?: string;
}

export interface MiniAppCustomer {
  id: number;
  telegram_id: number;
  phone?: string | null;
  display_name?: string | null;
  alias_username?: string | null;
  alias_email?: string | null;
  app_role?: MiniAppRole | null;
  account_status?: string | null;
  invite_code?: string | null;
  last_login_at?: string | null;
  created_at?: string | null;
}

export interface MiniAppDriverProfile {
  id: number;
  telegram_id: number;
  name: string;
  phone?: string | null;
  active: boolean;
  is_online: boolean;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  max_delivery_distance_miles: number;
  max_concurrent_orders: number;
  active_orders: number;
  delivered_orders: number;
  pickup_address?: {
    id: number;
    name: string;
    address: string;
  } | null;
  created_at?: string | null;
}

export interface MiniAppConfig {
  customer: MiniAppCustomer;
  app_role: MiniAppRole;
  driver_profile?: MiniAppDriverProfile | null;
  btc_discount_percent: number;
  contact: {
    welcome_message?: string | null;
    telegram_username?: string | null;
    phone_number?: string | null;
    email_address?: string | null;
    additional_info?: string | null;
  };
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  description?: string | null;
  price_cents: number;
  photo_url?: string | null;
  available_qty: number;
}

export interface CustomerAddress {
  id: number;
  label?: string | null;
  address_text: string;
  is_default: boolean;
  created_at?: string | null;
}

export interface PickupLocation {
  id: number;
  name: string;
  address: string;
  instructions?: string | null;
}

export interface MiniAppOrder {
  id: number;
  order_number: string;
  status: string;
  payment_status: string;
  payment_confirmed: boolean;
  payment_type: string;
  payment_label: string;
  delivery_or_pickup: string;
  pickup_address_text?: string | null;
  delivery_address_text?: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  items: OrderSummary['items'];
  notes?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  driver_name?: string | null;
  delivery_slot_et?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  payment_metadata?: Record<string, unknown>;
}
