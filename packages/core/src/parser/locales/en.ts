import type { ParserLocalePack } from '../types';

export const enLocalePack: ParserLocalePack = {
  locale: 'en',

  fillerWordsRegex: /^(?:um+|uh+|hey|ok|okay|so|like|please|can you|add|record|log)\b\s*/gi,

  numberWords: {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90
  },

  numberMultipliers: {
    hundred: 100,
    thousand: 1000,
    k: 1000,
    grand: 1000,
    million: 1000000
  },

  currencyNoiseRegex: /\b(?:dollars?|bucks?|usd|cents?)\b|[$€£]/gi,

  settlementTriggerRegex: /\b(?:paid\s+(?:back|me\s+back)|settled?\s+up|repaid|transferred|sent)\b/i,

  settleUpBalanceRegex: /\b(?:settle\s+up\s+with|clear\s+(?:debts?|balance)\s+with)\s+([a-zA-Z0-9_\- ]+)/i,

  selfPronouns: new Set(['i', 'me', 'myself']),

  everyoneWords: new Set(['everyone', 'everybody', 'all', 'the whole group']),

  inclusionPrepositionsRegex: /\b(?:split\s+with|with|between|among)\s+/gi,

  exclusionPrepositionsRegex: /\b(?:except|without|minus)\s+/gi,

  payerPatterns: [
    { regex: /^(?:i\s+paid|i\s+spent|i\s+bought)\b/i, groupIndex: 'self' },
    { regex: /\bpaid\s+by\s+([a-zA-Z0-9_\-]+)/i, groupIndex: 1 },
    { regex: /^([a-zA-Z0-9_\-]+)\s+paid\b/i, groupIndex: 1 }
  ],

  settlementDirectionPatterns: [
    // "I just paid Bob 20", "I paid Bob $20" - requires non-digit name!
    { regex: /^(?:i|me)\s+(?:just\s+)?(?:paid|sent|transferred|repaid)\s+(?:to\s+)?([a-zA-Z_\-][a-zA-Z0-9_\-]*)\b/i, fromGroup: 'self', toGroup: 1 },
    // "Bob paid me 20", "Bob transferred me 20"
    { regex: /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)\s+(?:paid|sent|transferred|repaid)\s+(?:to\s+)?(?:me|i)\b/i, fromGroup: 1, toGroup: 'self' },
    // "Alice paid Bob 20"
    { regex: /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)\s+(?:paid|sent|transferred|repaid)\s+(?:to\s+)?([a-zA-Z_\-][a-zA-Z0-9_\-]*)\b/i, fromGroup: 1, toGroup: 2 }
  ],

  paymentMethods: {
    cash: 'cash',
    venmo: 'venmo',
    paypal: 'paypal',
    zelle: 'bank_transfer',
    transfer: 'bank_transfer',
    'bank transfer': 'bank_transfer',
    wire: 'bank_transfer'
  },

  relativeDates: {
    today: 0,
    yesterday: -1
  },

  categoryKeywords: {
    dinner: 'food_dining',
    lunch: 'food_dining',
    breakfast: 'food_dining',
    coffee: 'food_dining',
    pizza: 'food_dining',
    burger: 'food_dining',
    drinks: 'food_dining',
    groceries: 'food_dining',
    grocery: 'food_dining',
    supermarket: 'food_dining',
    restaurant: 'food_dining',
    food: 'food_dining',
    uber: 'transportation',
    lyft: 'transportation',
    taxi: 'transportation',
    cab: 'transportation',
    gas: 'transportation',
    fuel: 'transportation',
    parking: 'transportation',
    toll: 'transportation',
    subway: 'transportation',
    train: 'transportation',
    bus: 'transportation',
    flight: 'transportation',
    hotel: 'accommodation',
    airbnb: 'accommodation',
    hostel: 'accommodation',
    lodging: 'accommodation',
    rent: 'accommodation',
    movie: 'entertainment',
    movies: 'entertainment',
    cinema: 'entertainment',
    tickets: 'entertainment',
    concert: 'entertainment',
    bowling: 'entertainment',
    game: 'entertainment',
    amazon: 'shopping',
    clothes: 'shopping',
    gift: 'shopping',
    pharmacy: 'shopping'
  },

  stopWords: new Set(['for', 'the', 'a', 'and', 'of', 'to', 'in', 'at', 'on', 'with'])
};
