import { SchemaDefinition, computeSchemaHash } from "@qozara/gdocs-schema";

export const QuozenSchema: SchemaDefinition = {
    version: 1,
    tabs: [
        {
            name: "Expenses",
            columns: [
                { name: "id", type: "string", required: true },
                { name: "date", type: "string" },
                { name: "description", type: "string" },
                { name: "amount", type: "number" },
                { name: "paidBy", type: "string" },
                { name: "category", type: "string" },
                { name: "splits", type: "string" }, // Stored as stringified JSON in the sheet
                { name: "meta", type: "string" }    // Optional metadata
            ]
        },
        {
            name: "Settlements",
            columns: [
                { name: "id", type: "string", required: true },
                { name: "date", type: "string" },
                { name: "fromUserId", type: "string" },
                { name: "toUserId", type: "string" },
                { name: "amount", type: "number" },
                { name: "method", type: "string" },
                { name: "notes", type: "string" }
            ]
        },
        {
            name: "Members",
            columns: [
                { name: "userId", type: "string", required: true },
                { name: "email", type: "string" },
                { name: "name", type: "string" },
                { name: "role", type: "string" },
                { name: "joinedAt", type: "string" }
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
