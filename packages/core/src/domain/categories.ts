export type ExpenseCategoryId = string;

export interface ExpenseCategory {
    id: ExpenseCategoryId;
    name: string;
    icon: string;
    description: string;
    sortOrder?: number;
    updatedAt?: Date;
    deletedAt?: Date;
}

export const DEFAULT_CATEGORY_ID: ExpenseCategoryId = 'other';

export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
    {
        id: 'food_dining',
        name: 'Food & Dining',
        icon: 'utensils',
        description: 'Restaurants, groceries, drinks',
        sortOrder: 0
    },
    {
        id: 'transportation',
        name: 'Transportation',
        icon: 'car',
        description: 'Taxis, fuel, public transit, flights',
        sortOrder: 1
    },
    {
        id: 'accommodation',
        name: 'Accommodation',
        icon: 'bed',
        description: 'Hotels, rentals, lodging',
        sortOrder: 2
    },
    {
        id: 'entertainment',
        name: 'Entertainment',
        icon: 'gamepad-2',
        description: 'Activities, tickets, leisure',
        sortOrder: 3
    },
    {
        id: 'shopping',
        name: 'Shopping',
        icon: 'shopping-bag',
        description: 'General purchases',
        sortOrder: 4
    },
    {
        id: 'other',
        name: 'Other',
        icon: 'more-horizontal',
        description: 'Anything else',
        sortOrder: 5
    }
];

function stripAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const SYNONYMS: Record<string, ExpenseCategoryId> = {
    // Food & Dining
    'food': 'food_dining',
    'food & dining': 'food_dining',
    'food and dining': 'food_dining',
    'dining': 'food_dining',
    'comida': 'food_dining',
    'groceries': 'food_dining',
    'grocery': 'food_dining',
    'supermarket': 'food_dining',
    'supermercado': 'food_dining',
    'restaurant': 'food_dining',
    'restaurants': 'food_dining',
    'restaurante': 'food_dining',
    'restaurantes': 'food_dining',
    'cafe': 'food_dining',
    'cafeteria': 'food_dining',
    'bar': 'food_dining',
    'drinks': 'food_dining',
    'bebidas': 'food_dining',

    // Transportation
    'transport': 'transportation',
    'transportation': 'transportation',
    'transporte': 'transportation',
    'travel': 'transportation',
    'viaje': 'transportation',
    'viajes': 'transportation',
    'gas': 'transportation',
    'gasolina': 'transportation',
    'fuel': 'transportation',
    'combustible': 'transportation',
    'taxi': 'transportation',
    'uber': 'transportation',
    'cab': 'transportation',
    'flight': 'transportation',
    'flights': 'transportation',
    'vuelo': 'transportation',
    'vuelos': 'transportation',
    'transit': 'transportation',
    'public transit': 'transportation',
    'subway': 'transportation',
    'metro': 'transportation',
    'bus': 'transportation',

    // Accommodation
    'accommodation': 'accommodation',
    'accommodations': 'accommodation',
    'lodging': 'accommodation',
    'hotel': 'accommodation',
    'hotels': 'accommodation',
    'hoteles': 'accommodation',
    'hostel': 'accommodation',
    'airbnb': 'accommodation',
    'rentals': 'accommodation',
    'alojamiento': 'accommodation',
    'hospedaje': 'accommodation',

    // Entertainment
    'entertainment': 'entertainment',
    'entretenimiento': 'entertainment',
    'leisure': 'entertainment',
    'activities': 'entertainment',
    'actividades': 'entertainment',
    'tickets': 'entertainment',
    'entradas': 'entertainment',
    'boletos': 'entertainment',
    'game': 'entertainment',
    'games': 'entertainment',
    'juegos': 'entertainment',
    'cinema': 'entertainment',
    'cine': 'entertainment',
    'movie': 'entertainment',
    'movies': 'entertainment',
    'fun': 'entertainment',
    'diversion': 'entertainment',

    // Shopping
    'shopping': 'shopping',
    'compras': 'shopping',
    'compra': 'shopping',
    'purchases': 'shopping',
    'general purchases': 'shopping',
    'tienda': 'shopping',
    'store': 'shopping',
    'clothes': 'shopping',
    'clothing': 'shopping',
    'ropa': 'shopping',

    // Other
    'other': 'other',
    'others': 'other',
    'otro': 'other',
    'otros': 'other',
    'misc': 'other',
    'miscellaneous': 'other',
    'general': 'other'
};

export function normalizeLegacyCategory(raw: unknown): ExpenseCategoryId {
    if (typeof raw !== 'string') return DEFAULT_CATEGORY_ID;
    const trimmed = raw.trim();
    if (!trimmed) return DEFAULT_CATEGORY_ID;

    // Check if already a valid default category ID (idempotent)
    const exactDefault = DEFAULT_CATEGORIES.find(c => c.id === trimmed);
    if (exactDefault) {
        return exactDefault.id;
    }

    const cleanInput = stripAccents(trimmed.toLowerCase());

    // Check lowercase default category ID
    const matchedById = DEFAULT_CATEGORIES.find(c => c.id.toLowerCase() === cleanInput);
    if (matchedById) {
        return matchedById.id;
    }

    // Check default category names
    const matchedByName = DEFAULT_CATEGORIES.find(
        c => stripAccents(c.name.toLowerCase()) === cleanInput
    );
    if (matchedByName) {
        return matchedByName.id;
    }

    // Check synonym map
    if (cleanInput in SYNONYMS) {
        return SYNONYMS[cleanInput];
    }

    // Unknown legacy categories deterministically map to 'other'
    return DEFAULT_CATEGORY_ID;
}

export function resolveCategory(
    input: unknown,
    availableCategories: ExpenseCategory[] = DEFAULT_CATEGORIES
): ExpenseCategory | undefined {
    if (typeof input !== 'string') return undefined;
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const list = Array.isArray(availableCategories) ? availableCategories : DEFAULT_CATEGORIES;

    // 1. Exact ID match
    const byId = list.find(c => c.id === trimmed);
    if (byId) return byId;

    // 2. Case-insensitive ID match
    const lower = trimmed.toLowerCase();
    const byIdLower = list.find(c => c.id.toLowerCase() === lower);
    if (byIdLower) return byIdLower;

    // 3. Case-insensitive name match
    const byName = list.find(
        c => c.name.toLowerCase() === lower
    );
    if (byName) return byName;

    const cleanInput = stripAccents(lower);
    const byNameClean = list.find(
        c => stripAccents(c.name.toLowerCase()) === cleanInput
    );
    if (byNameClean) return byNameClean;

    // 4. Fallback to synonym match
    if (cleanInput in SYNONYMS) {
        const synonymId = SYNONYMS[cleanInput];
        const bySynonym = list.find(c => c.id === synonymId);
        if (bySynonym) return bySynonym;
    }

    // Returns undefined if not matched
    return undefined;
}

const EXTRA_INFERENCE_KEYWORDS: Record<string, ExpenseCategoryId> = {
    // Food & Dining
    'breakfast': 'food_dining',
    'desayuno': 'food_dining',
    'lunch': 'food_dining',
    'almuerzo': 'food_dining',
    'dinner': 'food_dining',
    'cena': 'food_dining',
    'brunch': 'food_dining',
    'coffee': 'food_dining',
    'bakery': 'food_dining',
    'panaderia': 'food_dining',
    'pizza': 'food_dining',
    'sushi': 'food_dining',
    'burger': 'food_dining',
    'tacos': 'food_dining',
    'snacks': 'food_dining',
    'beer': 'food_dining',
    'cerveza': 'food_dining',
    'wine': 'food_dining',
    'vino': 'food_dining',

    // Transportation
    'airport': 'transportation',
    'aeropuerto': 'transportation',
    'lyft': 'transportation',
    'cabify': 'transportation',
    'train': 'transportation',
    'tren': 'transportation',
    'parking': 'transportation',
    'estacionamiento': 'transportation',
    'peaje': 'transportation',
    'toll': 'transportation',
    'ferry': 'transportation',

    // Accommodation
    'booking': 'accommodation',
    'resort': 'accommodation',
    'motel': 'accommodation',
    'cabin': 'accommodation',
    'cabana': 'accommodation',

    // Entertainment
    'concert': 'entertainment',
    'concierto': 'entertainment',
    'museum': 'entertainment',
    'museo': 'entertainment',
    'theater': 'entertainment',
    'theatre': 'entertainment',
    'teatro': 'entertainment',
    'bowling': 'entertainment',
    'club': 'entertainment',

    // Shopping
    'pharmacy': 'shopping',
    'farmacia': 'shopping',
    'gift': 'shopping',
    'regalo': 'shopping',
    'mall': 'shopping',
    'amazon': 'shopping',
    'market': 'shopping',
    'mercado': 'shopping'
};

const INFERENCE_STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'into', 'out', 'our', 'per', 'all',
    'con', 'para', 'por', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas',
    'general', 'anything', 'else', 'other', 'others', 'otro', 'otros', 'misc'
]);

/**
 * Infers an unambiguous ExpenseCategory from a free-text expense description.
 * Returns undefined if no keywords match or if multiple distinct categories match.
 */
export function inferCategoryFromText(
    input: unknown,
    availableCategories: ExpenseCategory[] = DEFAULT_CATEGORIES
): ExpenseCategory | undefined {
    if (typeof input !== 'string') return undefined;
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const list = Array.isArray(availableCategories) ? availableCategories : DEFAULT_CATEGORIES;
    if (list.length === 0) return undefined;

    const direct = resolveCategory(trimmed, list);
    if (direct) return direct;

    const clean = stripAccents(trimmed.toLowerCase());
    const tokens = clean.split(/[^a-z0-9]+/).filter(Boolean);
    if (tokens.length === 0) return undefined;

    const matchedIds = new Set<ExpenseCategoryId>();

    const recordDefaultKeywordMatch = (phrase: string) => {
        if (INFERENCE_STOPWORDS.has(phrase)) return;
        const targetId = SYNONYMS[phrase] ?? EXTRA_INFERENCE_KEYWORDS[phrase];
        if (!targetId || targetId === DEFAULT_CATEGORY_ID) return;
        const found = list.find(c => c.id === targetId);
        if (found) {
            matchedIds.add(found.id);
        }
    };

    for (let i = 0; i < tokens.length; i++) {
        if (i + 1 < tokens.length) {
            recordDefaultKeywordMatch(`${tokens[i]} ${tokens[i + 1]}`);
        }
        recordDefaultKeywordMatch(tokens[i]);
    }

    const meaningfulInputTokens = tokens.filter(
        t => t.length >= 3 && !INFERENCE_STOPWORDS.has(t) && !/^\d+$/.test(t)
    );

    if (meaningfulInputTokens.length > 0) {
        for (const cat of list) {
            if (cat.id === DEFAULT_CATEGORY_ID) continue;
            const catCorpus = stripAccents(
                `${cat.id} ${cat.name} ${cat.description || ''}`.toLowerCase()
            );
            const catWords = new Set(
                catCorpus
                    .split(/[^a-z0-9]+/)
                    .filter(w => w.length >= 3 && !INFERENCE_STOPWORDS.has(w))
            );
            if (meaningfulInputTokens.some(tok => catWords.has(tok))) {
                matchedIds.add(cat.id);
            }
        }
    }

    if (matchedIds.size === 1) {
        const [onlyId] = Array.from(matchedIds);
        return list.find(c => c.id === onlyId);
    }

    return undefined;
}

export function isValidCategoryId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    return /^[a-zA-Z0-9_-]+$/.test(id.trim());
}

export function humanizeCategoryId(id: string): string {
    const found = DEFAULT_CATEGORIES.find(c => c.id === id);
    if (found) return found.name;
    return id
        .split(/[_-]/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}
