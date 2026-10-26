/**
 * Client-side image compression and resizing utility for group icons and banners.
 * Compresses images to compact WebP/JPEG data URLs (~15-25 KB) suitable for storing
 * in Google Sheets metadata and local RxDB offline cache.
 */

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB raw upload limit

/**
 * Google Sheets has a hard limit of 50,000 characters per cell.
 * We enforce a safe threshold of 42,000 characters (~31.5 KB base64) to ensure
 * data URLs never cause a 400 Bad Request error when saved to the _meta tab.
 */
export const TARGET_MAX_DATA_URL_LENGTH = 42000;

export function isValidImageFile(file: File): boolean {
    return ALLOWED_MIME_TYPES.includes(file.type);
}

export async function compressImage(
    file: File,
    initialMaxDimension: number = 320,
    initialQuality: number = 0.75
): Promise<string> {
    if (!isValidImageFile(file)) {
        throw new Error("Invalid image format. Please select a JPG, PNG, or WebP image.");
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error("Image file is too large. Please select an image under 10MB.");
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            if (!dataUrl) {
                return reject(new Error("Failed to read image file"));
            }

            const img = new Image();
            img.onload = () => {
                try {
                    const encode = (targetDim: number, q: number): string => {
                        let { width, height } = img;

                        if (width > targetDim || height > targetDim) {
                            if (width > height) {
                                height = Math.round((height * targetDim) / width);
                                width = targetDim;
                            } else {
                                width = Math.round((width * targetDim) / height);
                                height = targetDim;
                            }
                        }

                        const canvas = document.createElement("canvas");
                        canvas.width = Math.max(1, width);
                        canvas.height = Math.max(1, height);

                        const ctx = canvas.getContext("2d");
                        if (!ctx) {
                            throw new Error("Could not initialize canvas context");
                        }

                        ctx.imageSmoothingEnabled = true;
                        ctx.imageSmoothingQuality = "high";
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                        // Prefer WebP for high compression ratio; fallback to JPEG
                        let compressed = canvas.toDataURL("image/webp", q);
                        if (!compressed.startsWith("data:image/webp")) {
                            compressed = canvas.toDataURL("image/jpeg", q);
                        }
                        return compressed;
                    };

                    let currentDim = initialMaxDimension;
                    let currentQuality = initialQuality;
                    let result = encode(currentDim, currentQuality);

                    // Adaptive compression loop: iteratively reduce dimensions and quality
                    // until data URL length is safely within the Google Sheets cell limit (<= 42000 chars)
                    let attempts = 0;
                    while (result.length > TARGET_MAX_DATA_URL_LENGTH && attempts < 6) {
                        attempts++;
                        currentDim = Math.max(120, Math.round(currentDim * 0.8));
                        currentQuality = Math.max(0.3, Math.round(currentQuality * 0.8 * 100) / 100);
                        result = encode(currentDim, currentQuality);
                    }

                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };

            img.onerror = () => reject(new Error("Could not load image"));
            img.src = dataUrl;
        };

        reader.onerror = () => reject(new Error("Error reading file"));
        reader.readAsDataURL(file);
    });
}
