import { z } from 'zod';

export const paymentCreateSchema = z.object({
  game_code: z.string().min(1, 'Game code is required'),
  product_code: z.string().min(1, 'Product code is required'),
  product_name: z.string().min(1, 'Product name is required'),
  game_name: z.string().min(1, 'Game name is required'),
  player_id: z.string().min(1, 'Player ID is required'),
  server_id: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
  promo_code: z.string().optional(),
});

export const orderCreateSchema = z.object({
  reference: z.string().min(1, 'Reference is required'),
  game_code: z.string().min(1, 'Game code is required'),
  product_code: z.string().min(1, 'Product code is required'),
  player_id: z.string().min(1, 'Player ID is required'),
  server_id: z.string().optional(),
  amount: z.number().positive('Amount must be positive'),
});

export const verifyPlayerSchema = z.object({
  game_code: z.string().min(1, 'Game code is required'),
  player_id: z.string().min(1, 'Player ID is required'),
  server_id: z.string().optional(),
});

export const paymentCallbackSchema = z.object({
  transactionId: z.string().min(1),
  amount: z.number(),
  status: z.string().min(1),
  reference: z.string().optional(),
  hash: z.string().optional(),
  timestamp: z.string().optional(),
});
