// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { compressImage, isValidImageFile } from "../image-compression";

describe("Image Compression Utility", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe("isValidImageFile", () => {
        it("returns true for valid image MIME types", () => {
            const validJpg = new File(["dummy"], "photo.jpg", { type: "image/jpeg" });
            const validPng = new File(["dummy"], "photo.png", { type: "image/png" });
            const validWebp = new File(["dummy"], "photo.webp", { type: "image/webp" });

            expect(isValidImageFile(validJpg)).toBe(true);
            expect(isValidImageFile(validPng)).toBe(true);
            expect(isValidImageFile(validWebp)).toBe(true);
        });

        it("returns false for non-image MIME types", () => {
            const pdf = new File(["dummy"], "doc.pdf", { type: "application/pdf" });
            const text = new File(["dummy"], "note.txt", { type: "text/plain" });

            expect(isValidImageFile(pdf)).toBe(false);
            expect(isValidImageFile(text)).toBe(false);
        });
    });

    describe("compressImage", () => {
        it("rejects when non-image file is provided", async () => {
            const invalidFile = new File(["hello"], "document.pdf", { type: "application/pdf" });
            await expect(compressImage(invalidFile)).rejects.toThrow("Invalid image format");
        });

        it("compresses and returns a data URL for an image", async () => {
            const mockDataUrl = "data:image/webp;base64,mockWebpData";

            // Mock Image and FileReader or canvas
            const origCreateElement = document.createElement.bind(document);
            vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
                if (tagName === "canvas") {
                    const canvas = origCreateElement("canvas");
                    canvas.toDataURL = vi.fn().mockReturnValue(mockDataUrl);
                    (canvas as any).getContext = vi.fn().mockReturnValue({
                        drawImage: vi.fn(),
                        imageSmoothingEnabled: true,
                        imageSmoothingQuality: "high"
                    });
                    return canvas;
                }
                return origCreateElement(tagName);
            });

            // Mock FileReader
            class MockFileReader {
                onload: any = null;
                onerror: any = null;
                readAsDataURL() {
                    setTimeout(() => {
                        this.onload?.({ target: { result: "data:image/jpeg;base64,orig" } });
                    }, 0);
                }
            }
            vi.stubGlobal("FileReader", MockFileReader);

            // Mock Image
            class MockImage {
                width = 800;
                height = 600;
                onload: any = null;
                set src(_val: string) {
                    setTimeout(() => {
                        this.onload?.();
                    }, 0);
                }
            }
            vi.stubGlobal("Image", MockImage);

            const file = new File(["imgdata"], "avatar.jpg", { type: "image/jpeg" });
            const result = await compressImage(file, 400);

            expect(result).toBe(mockDataUrl);
        });

        it("adaptively reduces dimensions and quality if output exceeds 42000 characters to fit within Google Sheets cell limit", async () => {
            const largeDataUrl = "data:image/webp;base64," + "A".repeat(52000);
            const fitDataUrl = "data:image/webp;base64," + "B".repeat(25000);

            let callCount = 0;
            const origCreateElement = document.createElement.bind(document);
            vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
                if (tagName === "canvas") {
                    const canvas = origCreateElement("canvas");
                    canvas.toDataURL = vi.fn().mockImplementation(() => {
                        callCount++;
                        return callCount === 1 ? largeDataUrl : fitDataUrl;
                    });
                    (canvas as any).getContext = vi.fn().mockReturnValue({
                        drawImage: vi.fn(),
                        imageSmoothingEnabled: true,
                        imageSmoothingQuality: "high"
                    });
                    return canvas;
                }
                return origCreateElement(tagName);
            });

            class MockFileReader {
                onload: any = null;
                onerror: any = null;
                readAsDataURL() {
                    setTimeout(() => {
                        this.onload?.({ target: { result: "data:image/jpeg;base64,orig" } });
                    }, 0);
                }
            }
            vi.stubGlobal("FileReader", MockFileReader);

            class MockImage {
                width = 1200;
                height = 1200;
                onload: any = null;
                set src(_val: string) {
                    setTimeout(() => {
                        this.onload?.();
                    }, 0);
                }
            }
            vi.stubGlobal("Image", MockImage);

            const file = new File(["imgdata"], "avatar.jpg", { type: "image/jpeg" });
            const result = await compressImage(file);

            expect(callCount).toBeGreaterThan(1);
            expect(result.length).toBeLessThanOrEqual(42000);
            expect(result).toBe(fitDataUrl);
        });
    });
});
