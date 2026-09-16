import { getGameCurrency } from './gameCurrency'

export interface PackageVisualInfo {
  /** Clean, polished display title (e.g. "Weekly Diamond Pass", "86", "Royale Pass") */
  displayTitle: string
  /** Sub-label or bonus if applicable (e.g. "+ 1 Bonus", "Save 60%", "7 Days") */
  subLabel?: string
  /** In-game currency name (e.g. "Diamonds", "UC", "Tokens", "Genesis Crystals") */
  displayCurrency: string
  /** Path to authentic SVG package image */
  imageUrl: string
  /** Is this an event pass, subscription, or special membership? */
  isPass: boolean
  /** Optional badge text to display (e.g. "Pass", "Event", "VIP", "7 Days") */
  passBadge?: string
  /** Accent glow color class */
  glowColor: string
  /** Numeric amount of currency (0 if pass or unquantifiable) */
  numericAmount: number
}

/**
 * Normalizes game code into a primary game category.
 */
export function normalizeGameCategory(gameCode: string = ''): string {
  const code = gameCode.toLowerCase()
  if (code.startsWith('mlbb') || code.includes('mobile_legends') || code.includes('mobile-legends')) return 'mlbb'
  if (code.startsWith('freefire') || code.includes('free_fire') || code.includes('ff_')) return 'freefire'
  if (code.startsWith('pubg') || code.includes('pubgm')) return 'pubg'
  if (code.startsWith('hok') || code.includes('honor') || code.includes('kings')) return 'hok'
  if (code.startsWith('genshin')) return 'genshin'
  if (code.startsWith('hsr') || code.includes('starrail') || code.includes('star_rail')) return 'hsr'
  if (code.startsWith('valorant') || code.includes('val')) return 'valorant'
  if (code.startsWith('roblox')) return 'roblox'
  if (code.startsWith('codm') || code.includes('call_of_duty') || code.includes('callofduty')) return 'codm'
  if (code.startsWith('bloodstrike') || code.includes('blood_strike')) return 'bloodstrike'
  return 'generic'
}

/**
 * Intelligently analyzes game code and raw product name from provider API
 * and returns rich visual metadata with authentic game package icons and clean copy.
 */
export function getPackageVisual(
  gameCode: string = '',
  rawProductName: string = '',
  _productCode: string = ''
): PackageVisualInfo {
  const category = normalizeGameCategory(gameCode)
  const name = rawProductName.trim()
  const lowerName = name.toLowerCase()

  // 1. Detect Pass / Membership / Special Event packages
  // ──────────────────────────────────────────────────────────
  if (category === 'mlbb') {
    if (lowerName.includes('weekly')) {
      const is2x = lowerName.includes('2x') || lowerName.includes('2 x') || lowerName.includes('double')
      return {
        displayTitle: is2x ? '2x Weekly Diamond Pass' : 'Weekly Diamond Pass',
        subLabel: 'Daily Claim (Up to 490 Diamonds)',
        displayCurrency: 'Pass',
        imageUrl: '/images/packages/mlbb-weekly-pass.svg',
        isPass: true,
        passBadge: is2x ? '2x Weekly' : '7-Day Pass',
        glowColor: 'from-blue-500/20 to-sky-500/20 border-sky-400/40',
        numericAmount: 0,
      }
    }
    if (lowerName.includes('twilight')) {
      return {
        displayTitle: 'Twilight Pass',
        subLabel: 'Season Pass (Skin + Rewards)',
        displayCurrency: 'Pass',
        imageUrl: '/images/packages/mlbb-twilight-pass.svg',
        isPass: true,
        passBadge: 'Twilight',
        glowColor: 'from-indigo-500/20 to-purple-500/20 border-indigo-400/40',
        numericAmount: 0,
      }
    }
    if (lowerName.includes('monthly') || lowerName.includes('epic') || lowerName.includes('bundle')) {
      return {
        displayTitle: 'Monthly Epic Pack',
        subLabel: 'Special Bundle',
        displayCurrency: 'Bundle',
        imageUrl: '/images/packages/mlbb-monthly-pack.svg',
        isPass: true,
        passBadge: 'Monthly',
        glowColor: 'from-amber-500/20 to-blue-500/20 border-amber-400/40',
        numericAmount: 0,
      }
    }
  }

  if (category === 'freefire') {
    if (lowerName.includes('weeklylite') || lowerName.includes('weekly lite')) {
      return {
        displayTitle: 'Weekly Lite VIP',
        subLabel: '7-Day Privilege',
        displayCurrency: 'Membership',
        imageUrl: '/images/packages/freefire-weekly-vip.svg',
        isPass: true,
        passBadge: 'Weekly Lite',
        glowColor: 'from-amber-500/20 to-yellow-500/20 border-yellow-400/40',
        numericAmount: 0,
      }
    }
    if (lowerName.includes('weekly')) {
      return {
        displayTitle: 'Weekly Membership VIP',
        subLabel: '450 Diamonds + Daily Icon',
        displayCurrency: 'Membership',
        imageUrl: '/images/packages/freefire-weekly-vip.svg',
        isPass: true,
        passBadge: 'Weekly VIP',
        glowColor: 'from-amber-500/20 to-orange-500/20 border-amber-400/40',
        numericAmount: 0,
      }
    }
    if (lowerName.includes('monthly')) {
      return {
        displayTitle: 'Monthly Membership VIP',
        subLabel: '2,600 Diamonds Value + Perks',
        displayCurrency: 'Membership',
        imageUrl: '/images/packages/freefire-monthly-vip.svg',
        isPass: true,
        passBadge: 'Monthly VIP',
        glowColor: 'from-rose-500/20 to-amber-500/20 border-rose-400/40',
        numericAmount: 0,
      }
    }
    if (lowerName.includes('level') || lowerName.includes('levelup')) {
      return {
        displayTitle: 'Level Up Pass',
        subLabel: 'Up to 1,000 Diamonds',
        displayCurrency: 'Event',
        imageUrl: '/images/packages/freefire-levelup.svg',
        isPass: true,
        passBadge: 'Level Up',
        glowColor: 'from-cyan-500/20 to-emerald-500/20 border-cyan-400/40',
        numericAmount: 0,
      }
    }
  }

  if (category === 'pubg') {
    if (lowerName.includes('elite') || lowerName.includes('royale') || lowerName.includes('rp') || lowerName.includes('pass')) {
      return {
        displayTitle: 'Royale Pass / Elite Pack',
        subLabel: 'Exclusive Outfits & Rewards',
        displayCurrency: 'Pass',
        imageUrl: '/images/packages/pubg-elite-pass.svg',
        isPass: true,
        passBadge: 'RP Pass',
        glowColor: 'from-amber-500/20 to-yellow-600/20 border-yellow-400/40',
        numericAmount: 0,
      }
    }
  }

  if (category === 'hok') {
    if (lowerName.includes('weekly') || lowerName.includes('card') || lowerName.includes('privilege')) {
      return {
        displayTitle: 'Weekly Privilege Card',
        subLabel: 'Daily Tokens + Benefits',
        displayCurrency: 'Privilege',
        imageUrl: '/images/packages/hok-weekly-card.svg',
        isPass: true,
        passBadge: 'Weekly Card',
        glowColor: 'from-amber-500/20 to-yellow-500/20 border-amber-400/40',
        numericAmount: 0,
      }
    }
  }

  if (category === 'genshin') {
    if (lowerName.includes('welkin') || lowerName.includes('blessing')) {
      return {
        displayTitle: 'Blessing of the Welkin Moon',
        subLabel: '300 Genesis + 2,700 Primogems',
        displayCurrency: 'Blessing',
        imageUrl: '/images/packages/genshin-welkin.svg',
        isPass: true,
        passBadge: '30 Days',
        glowColor: 'from-sky-500/20 to-indigo-500/20 border-sky-400/40',
        numericAmount: 0,
      }
    }
  }

  if (category === 'hsr') {
    if (lowerName.includes('supply') || lowerName.includes('express') || lowerName.includes('pass')) {
      return {
        displayTitle: 'Express Supply Pass',
        subLabel: '300 Shards + 2,700 Stellar Jades',
        displayCurrency: 'Supply Pass',
        imageUrl: '/images/packages/hsr-supply-pass.svg',
        isPass: true,
        passBadge: '30 Days',
        glowColor: 'from-amber-500/20 to-purple-500/20 border-amber-400/40',
        numericAmount: 0,
      }
    }
  }

  // Generic pass fallback if product mentions pass/membership
  if (lowerName.includes('pass') || lowerName.includes('membership') || lowerName.includes('vip') || lowerName.includes('subscription')) {
    return {
      displayTitle: name,
      displayCurrency: 'Pass',
      imageUrl: '/images/packages/generic-pass.svg',
      isPass: true,
      passBadge: 'VIP Pass',
      glowColor: 'from-amber-500/20 to-orange-500/20 border-amber-400/40',
      numericAmount: 0,
    }
  }

  // 2. Extract Numerical Amount & Bonus
  // ──────────────────────────────────────────────────────────
  const currencyName = getGameCurrency(gameCode) || 'Diamonds'
  let amount = 0
  let bonus = ''
  let displayTitle = name

  // Check for bonus formats: "86 + 1 Bonus", "86 Diamonds + 1 Bonus", "600+60 UC", "500 (+50)"
  const bonusMatch = name.match(/(\d[\d,]*)\s*(?:Diamonds|Diamond|UC|Tokens|Tokens|CP|Robux)?\s*(\+\s*\d+[^)]*|\(\s*\+\s*\d+[^)]*\))/i)
  if (bonusMatch) {
    amount = parseInt(bonusMatch[1].replace(/,/g, ''), 10)
    bonus = bonusMatch[2].replace(/[()]/g, '').trim()
    displayTitle = bonusMatch[1]
  } else {
    // Normal numeric match
    const numMatch = name.match(/(\d[\d,]*)/)
    if (numMatch) {
      amount = parseInt(numMatch[1].replace(/,/g, ''), 10)
      displayTitle = numMatch[1]
    }
  }

  // 3. Resolve Real Game Package Image by Tier
  // ──────────────────────────────────────────────────────────
  let imageUrl = '/images/packages/generic-gem.svg'
  let glowColor = 'from-primary-500/10 to-blue-500/10 border-primary-500/20'

  switch (category) {
    case 'mlbb':
      glowColor = 'from-sky-500/10 to-blue-600/10 border-sky-400/30'
      if (amount <= 100) {
        imageUrl = '/images/packages/mlbb-diamond-single.svg'
      } else if (amount <= 500) {
        imageUrl = '/images/packages/mlbb-diamond-stack.svg'
      } else if (amount <= 1500) {
        imageUrl = '/images/packages/mlbb-diamond-pile.svg'
      } else {
        imageUrl = '/images/packages/mlbb-diamond-chest.svg'
      }
      break

    case 'freefire':
      glowColor = 'from-cyan-500/10 to-rose-600/10 border-cyan-400/30'
      if (amount <= 100) {
        imageUrl = '/images/packages/freefire-diamond-single.svg'
      } else if (amount <= 600) {
        imageUrl = '/images/packages/freefire-diamond-stack.svg'
      } else {
        imageUrl = '/images/packages/freefire-diamond-chest.svg'
      }
      break

    case 'pubg':
      glowColor = 'from-amber-500/10 to-yellow-600/10 border-yellow-400/30'
      if (amount <= 60) {
        imageUrl = '/images/packages/pubg-uc-single.svg'
      } else if (amount <= 600) {
        imageUrl = '/images/packages/pubg-uc-stack.svg'
      } else {
        imageUrl = '/images/packages/pubg-uc-crate.svg'
      }
      break

    case 'hok':
      glowColor = 'from-amber-500/10 to-emerald-600/10 border-amber-400/30'
      if (amount <= 100) {
        imageUrl = '/images/packages/hok-token-single.svg'
      } else {
        imageUrl = '/images/packages/hok-token-stack.svg'
      }
      break

    case 'genshin':
      glowColor = 'from-sky-500/10 to-indigo-600/10 border-sky-400/30'
      imageUrl = '/images/packages/genshin-crystal.svg'
      break

    case 'hsr':
      glowColor = 'from-amber-500/10 to-purple-600/10 border-amber-400/30'
      imageUrl = '/images/packages/hsr-shard.svg'
      break

    case 'valorant':
      glowColor = 'from-rose-500/10 to-red-600/10 border-rose-400/30'
      imageUrl = '/images/packages/valorant-vp.svg'
      break

    case 'roblox':
      glowColor = 'from-slate-500/10 to-amber-600/10 border-amber-400/30'
      imageUrl = '/images/packages/roblox-robux.svg'
      break

    case 'codm':
      glowColor = 'from-amber-500/10 to-yellow-600/10 border-yellow-400/30'
      imageUrl = '/images/packages/codm-cp.svg'
      break

    case 'bloodstrike':
      glowColor = 'from-red-500/10 to-amber-600/10 border-red-400/30'
      imageUrl = '/images/packages/bloodstrike-gold.svg'
      break

    default:
      if (currencyName.toLowerCase().includes('coin') || currencyName.toLowerCase().includes('gold')) {
        imageUrl = '/images/packages/generic-coin.svg'
      } else {
        imageUrl = '/images/packages/generic-gem.svg'
      }
      break
  }

  return {
    displayTitle,
    subLabel: bonus || undefined,
    displayCurrency: currencyName,
    imageUrl,
    isPass: false,
    glowColor,
    numericAmount: amount,
  }
}
