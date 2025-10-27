import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHUNK_IHDR = "IHDR";
const CHUNK_IDAT = "IDAT";
const CHUNK_IEND = "IEND";

const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const EXPECTED_BIT_DEPTH = 8;

/**
 * Decode an RGBA PNG buffer (8-bit depth, non-interlaced) into raw pixel data.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function decodePng(buffer) {
    assert.ok(Buffer.isBuffer(buffer), "decodePng expects a Buffer input");
    if (buffer.length < PNG_SIGNATURE.length) {
        throw new Error("decodePng: buffer too small");
    }
    for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
        if (buffer[i] !== PNG_SIGNATURE[i]) {
            throw new Error("decodePng: invalid PNG signature");
        }
    }

    let offset = PNG_SIGNATURE.length;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlaceMethod = 0;
    /** @type {Buffer[]} */
    const idatChunks = [];

    while (offset < buffer.length) {
        if (offset + 8 > buffer.length) {
            throw new Error("decodePng: truncated chunk header");
        }
        const length = buffer.readUInt32BE(offset);
        offset += 4;
        const type = buffer.slice(offset, offset + 4).toString("ascii");
        offset += 4;
        if (offset + length + 4 > buffer.length) {
            throw new Error("decodePng: truncated chunk data");
        }
        const chunkData = buffer.slice(offset, offset + length);
        offset += length;
        // Skip CRC
        offset += 4;

        if (type === CHUNK_IHDR) {
            width = chunkData.readUInt32BE(0);
            height = chunkData.readUInt32BE(4);
            bitDepth = chunkData.readUInt8(8);
            colorType = chunkData.readUInt8(9);
            const compressionMethod = chunkData.readUInt8(10);
            const filterMethod = chunkData.readUInt8(11);
            interlaceMethod = chunkData.readUInt8(12);
            if (compressionMethod !== 0 || filterMethod !== 0) {
                throw new Error("decodePng: unsupported compression or filter method");
            }
        } else if (type === CHUNK_IDAT) {
            idatChunks.push(chunkData);
        } else if (type === CHUNK_IEND) {
            break;
        }
    }

    if (width <= 0 || height <= 0) {
        throw new Error("decodePng: invalid dimensions");
    }
    if (bitDepth !== EXPECTED_BIT_DEPTH) {
        throw new Error("decodePng: only 8-bit PNGs are supported");
    }
    if (colorType !== COLOR_TYPE_RGBA && colorType !== COLOR_TYPE_RGB) {
        throw new Error("decodePng: unsupported color type");
    }
    if (interlaceMethod !== 0) {
        throw new Error("decodePng: interlaced PNGs are not supported");
    }

    const compressed = Buffer.concat(idatChunks);
    const inflated = inflateSync(compressed);

    const bytesPerPixel = colorType === COLOR_TYPE_RGBA ? 4 : 3;
    const stride = width * bytesPerPixel;
    const expectedLength = (stride + 1) * height;
    if (inflated.length !== expectedLength) {
        throw new Error("decodePng: unexpected inflated data length");
    }

    const output = new Uint8Array(width * height * 4);
    const priorRow = new Uint8Array(stride);
    const targetRow = new Uint8Array(stride);

    for (let row = 0; row < height; row += 1) {
        const rowStart = row * (stride + 1);
        const filterType = inflated[rowStart];
        const currentRow = inflated.subarray(rowStart + 1, rowStart + 1 + stride);

        switch (filterType) {
            case 0:
                targetRow.set(currentRow);
                break;
            case 1:
                applySubFilter(currentRow, targetRow, bytesPerPixel);
                break;
            case 2:
                applyUpFilter(currentRow, targetRow, priorRow);
                break;
            case 3:
                applyAverageFilter(currentRow, targetRow, priorRow, bytesPerPixel);
                break;
            case 4:
                applyPaethFilter(currentRow, targetRow, priorRow, bytesPerPixel);
                break;
            default:
                throw new Error(`decodePng: unsupported filter type ${filterType}`);
        }

        const destOffset = row * width * 4;
        if (colorType === COLOR_TYPE_RGBA) {
            output.set(targetRow, destOffset);
        } else {
            for (let pixel = 0; pixel < width; pixel += 1) {
                const srcIndex = pixel * bytesPerPixel;
                const destIndex = destOffset + pixel * 4;
                output[destIndex] = targetRow[srcIndex];
                output[destIndex + 1] = targetRow[srcIndex + 1];
                output[destIndex + 2] = targetRow[srcIndex + 2];
                output[destIndex + 3] = 255;
            }
        }

        priorRow.set(targetRow);
    }

    return { width, height, data: output };
}

function applySubFilter(source, target, bytesPerPixel) {
    for (let i = 0; i < source.length; i += 1) {
        const left = i >= bytesPerPixel ? target[i - bytesPerPixel] : 0;
        target[i] = (source[i] + left) & 0xff;
    }
}

function applyUpFilter(source, target, priorRow) {
    for (let i = 0; i < source.length; i += 1) {
        target[i] = (source[i] + priorRow[i]) & 0xff;
    }
}

function applyAverageFilter(source, target, priorRow, bytesPerPixel) {
    for (let i = 0; i < source.length; i += 1) {
        const left = i >= bytesPerPixel ? target[i - bytesPerPixel] : 0;
        const up = priorRow[i];
        const average = Math.floor((left + up) / 2);
        target[i] = (source[i] + average) & 0xff;
    }
}

function applyPaethFilter(source, target, priorRow, bytesPerPixel) {
    for (let i = 0; i < source.length; i += 1) {
        const left = i >= bytesPerPixel ? target[i - bytesPerPixel] : 0;
        const up = priorRow[i];
        const upLeft = i >= bytesPerPixel ? priorRow[i - bytesPerPixel] : 0;
        const paeth = paethPredictor(left, up, upLeft);
        target[i] = (source[i] + paeth) & 0xff;
    }
}

function paethPredictor(left, up, upLeft) {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    if (pa <= pb && pa <= pc) return left;
    if (pb <= pc) return up;
    return upLeft;
}
