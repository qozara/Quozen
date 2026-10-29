import { SchemaDefinition, computeSchemaHash } from "@qozara/gdocs-schema";

export const QuozenSchema: SchemaDefinition = {
    version: 3,
    tabs: [
        {
            name: "Expenses",
            columns: [
                { name: "id", type: "string", required: true },
                { name: "date", type: "string", required: true },
                { name: "description", type: "string", required: true },
                { name: "amount", type: "number", required: true },
                { name: "paidBy", type: "string", required: true },
                { name: "category", type: "string", required: true },
                { name: "splits", type: "string", required: true }, // Stored as stringified JSON in the sheet
                { name: "meta", type: "string" }    // Optional metadata
            ]
        },
        {
            name: "Settlements",
            columns: [
                { name: "id", type: "string", required: true },
                { name: "date", type: "string", required: true },
                { name: "fromUserId", type: "string", required: true },
                { name: "toUserId", type: "string", required: true },
                { name: "amount", type: "number", required: true },
                { name: "method", type: "string", required: true },
                { name: "notes", type: "string" } // Optional
            ]
        },
        {
            name: "Members",
            columns: [
                { name: "userId", type: "string", required: true },
                { name: "email", type: "string" }, // Some users might not have email, though we map it
                { name: "name", type: "string", required: true },
                { name: "role", type: "string", required: true },
                { name: "joinedAt", type: "string", required: true }
            ]
        },
        {
            name: "Categories",
            columns: [
                { name: "id", type: "string", required: true },
                { name: "name", type: "string", required: true },
                { name: "icon", type: "string" },
                { name: "description", type: "string" },
                { name: "updatedAt", type: "string" },
                { name: "deletedAt", type: "string" }
            ]
        },
        {
            name: "_meta",
            columns: [
                { name: "key", type: "string", required: true },
                { name: "value", type: "string", required: true },
                { name: "updatedAt", type: "string", required: true }
            ]
        }
    ]
};

// Node.js fallback hashing for environments where Web Crypto API isn't present
export const getQuozenSchemaHash = async (): Promise<string> => {
    return computeSchemaHash(QuozenSchema, async (data) => {
        if (typeof crypto !== "undefined" && crypto.subtle) {
            const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
            return Array.from(new Uint8Array(buffer))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        } else {
            // Fallback for Node.js using crypto module
            // @ts-ignore: node crypto fallback
            const nodeCrypto = await import("crypto");
            return nodeCrypto.createHash("sha256").update(data).digest("hex");
        }
    });
};
