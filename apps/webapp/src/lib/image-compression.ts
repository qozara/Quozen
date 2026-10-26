/**
 * Client-side image compression and resizing utility for group icons and banners.
 * Compresses images to compact WebP/JPEG data URLs (~15-25 KB) suitable for storing
 * in Google Sheets metadata and local RxDB offline cache.
 */

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB raw upload limit

export function isValidImageFile(file: File): boolean {
    return ALLOWED_MIME_TYPES.includes(file.type);
}

export async function compressImage(
    file: File,
    maxDimension: number = 400,
    quality: number = 0.75
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
                    let { width, height } = img;

                    if (width > maxDimension || height > maxDimension) {
                        if (width > height) {
                            height = Math.round((height * maxDimension) / width);
                            width = maxDimension;
                        } else {
                            width = Math.round((width * maxDimension) / height);
                            height = maxDimension;
                        }
                    }

                    const canvas = document.createElement("canvas");
                    canvas.width = Math.max(1, width);
                    canvas.height = Math.max(1, height);

                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        return reject(new Error("Could not initialize canvas context"));
                    }

                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    // Prefer WebP for high compression ratio; fallback to JPEG
                    let compressed = canvas.toDataURL("image/webp", quality);
                    if (!compressed.startsWith("data:image/webp")) {
                        compressed = canvas.toDataURL("image/jpeg", quality);
                    }

                    resolve(compressed);
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
