import type { ParserLocalePack } from '../types';

export const esLocalePack: ParserLocalePack = {
  locale: 'es',

  fillerWordsRegex: /^(?:eh+|este+|bueno|o sea|che|por favor|agrega|agregar|anota|anotar|registra|registrar|pone|poner)(?:[^\p{L}\p{N}]+|$)/giu,

  numberWords: {
    cero: 0,
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    once: 11,
    doce: 12,
    trece: 13,
    catorce: 14,
    quince: 15,
    dieciseis: 16,
    diecisiete: 17,
    dieciocho: 18,
    diecinueve: 19,
    veinte: 20,
    veintiuno: 21,
    veintidos: 22,
    veintitres: 23,
    veinticuatro: 24,
    veinticinco: 25,
    veintiseis: 26,
    veintisiete: 27,
    veintiocho: 28,
    veintinueve: 29,
    treinta: 30,
    cuarenta: 40,
    cincuenta: 50,
    sesenta: 60,
    setenta: 70,
    ochenta: 80,
    noventa: 90,
    cien: 100,
    ciento: 100,
    doscientos: 200,
    trescientos: 300,
    cuatrocientos: 400,
    quinientos: 500,
    seiscientos: 600,
    setecientos: 700,
    ochocientos: 800,
    novecientos: 900
  },

  numberMultipliers: {
    mil: 1000,
    luca: 1000,
    lucas: 1000,
    k: 1000,
    millon: 1000000,
    millones: 1000000
  },

  currencyNoiseRegex: /\b(?:pesos?|dolares?|dólares?|mangos?|ars|usd|centavos?)\b|[$€£]/gi,

  settlementTriggerRegex: /(?:le\s+pagu[eé]|me\s+pag[oó]|me\s+devolvi[oó]|devolví|le\s+transferí|me\s+transfiri[oó]|le\s+mand[eé]|saldar|sald[eé])(?:[^\p{L}\p{N}]|$)/iu,

  settleUpBalanceRegex: /(?:saldar\s+(?:cuenta\s+)?con|quedar\s+a\s+mano\s+con)\s+([\p{L}0-9_\- ]+)/iu,

  selfPronouns: new Set(['yo', 'me', 'mi', 'mí']),

  everyoneWords: new Set(['todos', 'todas', 'todo el grupo', 'todos los miembros']),

  inclusionPrepositionsRegex: /(?:con|entre)\s+/giu,

  exclusionPrepositionsRegex: /(?:menos|sin|excepto)\s+/giu,

  payerPatterns: [
    { regex: /^(?:pagu[eé]|gast[eé]|compr[eé])(?:[^\p{L}\p{N}]|$)/iu, groupIndex: 'self' },
    { regex: /^yo\s+(?:pagu[eé]|gast[eé]|compr[eé])(?:[^\p{L}\p{N}]|$)/iu, groupIndex: 'self' },
    { regex: /pagado\s+por\s+([\p{L}_\-][\p{L}0-9_\-]*)/iu, groupIndex: 1 },
    { regex: /^(?:pagó|pago)\s+([\p{L}_\-][\p{L}0-9_\-]*)(?:[^\p{L}\p{N}]|$)/iu, groupIndex: 1 },
    { regex: /^([\p{L}_\-][\p{L}0-9_\-]*)\s+(?:pagó|pago)(?:[^\p{L}\p{N}]|$)/iu, groupIndex: 1 }
  ],

  settlementDirectionPatterns: [
    // "Le pagué a Alice", "Pagué a Bob"
    { regex: /^(?:le\s+)?pagu[eé]\s+(?:a\s+)?([\p{L}_\-][\p{L}0-9_\-]*)(?:[^\p{L}\p{N}]|$)/iu, fromGroup: 'self', toGroup: 1 },
    { regex: /^transfer[ií]\s+(?:a\s+)?([\p{L}_\-][\p{L}0-9_\-]*)(?:[^\p{L}\p{N}]|$)/iu, fromGroup: 'self', toGroup: 1 },
    // "Bob me pagó", "Bob me transfirió", "Bob me devolvió"
    { regex: /^([\p{L}_\-][\p{L}0-9_\-]*)\s+me\s+(?:pagó|pago|transfirió|transfirio|devolvió|devolvio)(?:[^\p{L}\p{N}]|$)/iu, fromGroup: 1, toGroup: 'self' },
    // "Alice le pagó a Bob"
    { regex: /^([\p{L}_\-][\p{L}0-9_\-]*)\s+le\s+pagó\s+(?:a\s+)?([\p{L}_\-][\p{L}0-9_\-]*)(?:[^\p{L}\p{N}]|$)/iu, fromGroup: 1, toGroup: 2 }
  ],

  paymentMethods: {
    efectivo: 'cash',
    cash: 'cash',
    transferencia: 'bank_transfer',
    transfer: 'bank_transfer',
    banco: 'bank_transfer',
    mercadopago: 'bank_transfer',
    mp: 'bank_transfer',
    zelle: 'bank_transfer',
    bizum: 'bank_transfer',
    venmo: 'venmo',
    paypal: 'paypal'
  },

  relativeDates: {
    hoy: 0,
    ayer: -1,
    anteayer: -2
  },

  categoryKeywords: {
    cena: 'food_dining',
    almuerzo: 'food_dining',
    desayuno: 'food_dining',
    merienda: 'food_dining',
    cafe: 'food_dining',
    café: 'food_dining',
    comida: 'food_dining',
    asado: 'food_dining',
    supermercado: 'food_dining',
    super: 'food_dining',
    verduleria: 'food_dining',
    verdulería: 'food_dining',
    carniceria: 'food_dining',
    carnicería: 'food_dining',
    empanadas: 'food_dining',
    helado: 'food_dining',
    birra: 'food_dining',
    cerveza: 'food_dining',
    bebidas: 'food_dining',
    restaurante: 'food_dining',
    pizza: 'food_dining',
    uber: 'transportation',
    cabify: 'transportation',
    didi: 'transportation',
    taxi: 'transportation',
    nafta: 'transportation',
    gasolina: 'transportation',
    combustible: 'transportation',
    peaje: 'transportation',
    estacionamiento: 'transportation',
    subte: 'transportation',
    colectivo: 'transportation',
    tren: 'transportation',
    pasaje: 'transportation',
    pasajes: 'transportation',
    vuelo: 'transportation',
    vuelos: 'transportation',
    hotel: 'accommodation',
    airbnb: 'accommodation',
    hostel: 'accommodation',
    alojamiento: 'accommodation',
    hospedaje: 'accommodation',
    alquiler: 'accommodation',
    cabaña: 'accommodation',
    cine: 'entertainment',
    entradas: 'entertainment',
    recital: 'entertainment',
    teatro: 'entertainment',
    partido: 'entertainment',
    boliche: 'entertainment',
    juegos: 'entertainment',
    tienda: 'shopping',
    ropa: 'shopping',
    regalo: 'shopping',
    regalos: 'shopping',
    farmacia: 'shopping',
    compras: 'shopping'
  },

  stopWords: new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'uno', 'y', 'e', 'con', 'en', 'para', 'por', 'al', 'a'])
};
