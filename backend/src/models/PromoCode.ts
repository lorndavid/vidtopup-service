import mongoose, { Schema, Document } from 'mongoose';

export type DiscountType = 'fixed' | 'percentage';

export interface IPromoCode extends Document {
  code: string;
  discount_type: DiscountType;
  discount_value: number; // USD amount (e.g. 0.50) or Percentage (e.g. 10 for 10%)
  max_discount_amount?: number; // Cap in USD for percentage discount
  min_spend?: number; // Minimum order subtotal required (in USD)
  start_date?: Date;
  end_date?: Date;
  usage_limit?: number; // Total allowed usages (null = unlimited)
  used_count: number;
  is_active: boolean;
  applicable_games?: string[]; // Empty array means valid for all games
  created_at: Date;
  updated_at: Date;
}

const PromoCodeSchema: Schema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    discount_type: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: true,
      default: 'fixed',
    },
    discount_value: {
      type: Number,
      required: true,
      min: 0.01,
    },
    max_discount_amount: {
      type: Number,
      default: null,
    },
    min_spend: {
      type: Number,
      default: 0,
    },
    start_date: {
      type: Date,
      default: null,
    },
    end_date: {
      type: Date,
      default: null,
    },
    usage_limit: {
      type: Number,
      default: null,
    },
    used_count: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    applicable_games: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const PromoCodeModel = mongoose.model<IPromoCode>('PromoCode', PromoCodeSchema);
