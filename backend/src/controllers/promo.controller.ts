import { Request, Response, NextFunction } from 'express';
import { PromoCodeModel } from '../models/PromoCode';
import { HTTP_STATUS } from '../constants';
import { AppError } from '../middleware/errorHandler';

/**
 * Public: Validate a promo code against an order's subtotal and game code.
 */
export async function validatePromoCode(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { code, game_code, amount } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('Promo code is required', HTTP_STATUS.BAD_REQUEST);
    }

    const subtotal = Number(amount);
    if (isNaN(subtotal) || subtotal <= 0) {
      throw new AppError('Valid order amount is required', HTTP_STATUS.BAD_REQUEST);
    }

    const cleanCode = code.trim().toUpperCase();
    const promo = await PromoCodeModel.findOne({ code: cleanCode });

    if (!promo) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        valid: false,
        message: 'Invalid promo code. Please check and try again.',
      });
      return;
    }

    if (!promo.is_active) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: 'This promo code is currently inactive or has expired.',
      });
      return;
    }

    const now = new Date();
    if (promo.start_date && now < new Date(promo.start_date)) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: 'This promo code is not active yet.',
      });
      return;
    }

    if (promo.end_date && now > new Date(promo.end_date)) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: 'This promo code has expired.',
      });
      return;
    }

    if (promo.usage_limit && promo.used_count >= promo.usage_limit) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: 'This promo code has reached its maximum usage limit.',
      });
      return;
    }

    if (promo.min_spend && subtotal < promo.min_spend) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: `Minimum order amount of $${promo.min_spend.toFixed(2)} required for this promo.`,
      });
      return;
    }

    if (
      promo.applicable_games &&
      promo.applicable_games.length > 0 &&
      game_code &&
      !promo.applicable_games.includes(game_code)
    ) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        valid: false,
        message: 'This promo code is not applicable to this game.',
      });
      return;
    }

    // Calculate discount
    let discount = 0;
    if (promo.discount_type === 'percentage') {
      discount = (subtotal * promo.discount_value) / 100;
      if (promo.max_discount_amount && discount > promo.max_discount_amount) {
        discount = promo.max_discount_amount;
      }
    } else {
      // Fixed money discount
      discount = promo.discount_value;
    }

    // Round discount to 2 decimals
    discount = Math.round(discount * 100) / 100;

    // Minimum charge is $0.01 (cannot be negative or zero)
    if (discount >= subtotal) {
      discount = Math.max(0, Math.round((subtotal - 0.01) * 100) / 100);
    }

    const finalAmount = Math.max(0.01, Math.round((subtotal - discount) * 100) / 100);

    const discountSummary =
      promo.discount_type === 'percentage'
        ? `${promo.discount_value}% OFF (-$${discount.toFixed(2)})`
        : `-$${discount.toFixed(2)} OFF`;

    res.status(HTTP_STATUS.OK).json({
      success: true,
      valid: true,
      data: {
        code: promo.code,
        discount_type: promo.discount_type,
        discount_value: promo.discount_value,
        discount_amount: discount,
        final_amount: finalAmount,
        original_amount: subtotal,
        message: `Promo applied: ${discountSummary}`,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Get all promo codes
 */
export async function getAdminPromos(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const promos = await PromoCodeModel.find().sort({ created_at: -1 }).lean();
    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Promo codes fetched',
      data: promos,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Create a promo code
 */
export async function createAdminPromo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      code,
      discount_type,
      discount_value,
      max_discount_amount,
      min_spend,
      start_date,
      end_date,
      usage_limit,
      applicable_games,
      is_active,
    } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('Promo code string is required', HTTP_STATUS.BAD_REQUEST);
    }

    const cleanCode = code.trim().toUpperCase();
    const existing = await PromoCodeModel.findOne({ code: cleanCode });
    if (existing) {
      throw new AppError(`Promo code "${cleanCode}" already exists`, HTTP_STATUS.CONFLICT);
    }

    const numValue = Number(discount_value);
    if (isNaN(numValue) || numValue <= 0) {
      throw new AppError('Discount value must be greater than 0', HTTP_STATUS.BAD_REQUEST);
    }

    if (discount_type === 'percentage' && numValue > 100) {
      throw new AppError('Percentage discount cannot exceed 100%', HTTP_STATUS.BAD_REQUEST);
    }

    const promo = await PromoCodeModel.create({
      code: cleanCode,
      discount_type: discount_type === 'percentage' ? 'percentage' : 'fixed',
      discount_value: numValue,
      max_discount_amount: max_discount_amount ? Number(max_discount_amount) : undefined,
      min_spend: min_spend ? Number(min_spend) : 0,
      start_date: start_date ? new Date(start_date) : undefined,
      end_date: end_date ? new Date(end_date) : undefined,
      usage_limit: usage_limit ? Number(usage_limit) : undefined,
      applicable_games: Array.isArray(applicable_games) ? applicable_games : [],
      is_active: is_active !== false,
      used_count: 0,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: 'Promo code created successfully',
      data: promo,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Update a promo code
 */
export async function updateAdminPromo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const {
      discount_type,
      discount_value,
      max_discount_amount,
      min_spend,
      start_date,
      end_date,
      usage_limit,
      applicable_games,
      is_active,
    } = req.body;

    const promo = await PromoCodeModel.findById(id);
    if (!promo) {
      throw new AppError('Promo code not found', HTTP_STATUS.NOT_FOUND);
    }

    if (discount_type) {
      promo.discount_type = discount_type === 'percentage' ? 'percentage' : 'fixed';
    }
    if (discount_value !== undefined) {
      const val = Number(discount_value);
      if (isNaN(val) || val <= 0) {
        throw new AppError('Discount value must be greater than 0', HTTP_STATUS.BAD_REQUEST);
      }
      promo.discount_value = val;
    }
    if (max_discount_amount !== undefined) {
      promo.max_discount_amount = max_discount_amount ? Number(max_discount_amount) : undefined;
    }
    if (min_spend !== undefined) {
      promo.min_spend = Number(min_spend) || 0;
    }
    if (start_date !== undefined) {
      promo.start_date = start_date ? new Date(start_date) : undefined;
    }
    if (end_date !== undefined) {
      promo.end_date = end_date ? new Date(end_date) : undefined;
    }
    if (usage_limit !== undefined) {
      promo.usage_limit = usage_limit ? Number(usage_limit) : undefined;
    }
    if (applicable_games !== undefined) {
      promo.applicable_games = Array.isArray(applicable_games) ? applicable_games : [];
    }
    if (is_active !== undefined) {
      promo.is_active = Boolean(is_active);
    }

    await promo.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Promo code updated successfully',
      data: promo,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Delete a promo code
 */
export async function deleteAdminPromo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const result = await PromoCodeModel.findByIdAndDelete(id);
    if (!result) {
      throw new AppError('Promo code not found', HTTP_STATUS.NOT_FOUND);
    }

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: 'Promo code deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin: Toggle promo code active status
 */
export async function toggleAdminPromo(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const promo = await PromoCodeModel.findById(id);
    if (!promo) {
      throw new AppError('Promo code not found', HTTP_STATUS.NOT_FOUND);
    }

    promo.is_active = !promo.is_active;
    await promo.save();

    res.status(HTTP_STATUS.OK).json({
      success: true,
      message: `Promo code ${promo.is_active ? 'activated' : 'deactivated'} successfully`,
      data: promo,
    });
  } catch (error) {
    next(error);
  }
}
