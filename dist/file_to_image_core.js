"use strict";
(() => {
    const MAX_UINT16 = 0xffff;
    const MAX_UINT32 = 0xffffffff;
    const UTF8_FLAG = 0x0800;
    const ZIP_VERSION_20 = 20;
    const LOCAL_HEADER_SIGNATURE = 0x04034b50;
    const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
    const EOCD_SIGNATURE = 0x06054b50;
    const textEncoder = new TextEncoder();
    const crc32Table = (() => {
        const table = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) {
                value = (value & 1) !== 0
                    ? (0xedb88320 ^ (value >>> 1))
                    : (value >>> 1);
            }
            table[index] = value >>> 0;
        }
        return table;
    })();
    function writeUint16(view, offset, value) {
        view.setUint16(offset, value & MAX_UINT16, true);
    }
    function writeUint32(view, offset, value) {
        view.setUint32(offset, value >>> 0, true);
    }
    function readAscii(bytes, start, length) {
        let result = "";
        const end = Math.min(bytes.length, start + length);
        for (let index = start; index < end; index += 1) {
            result += String.fromCharCode(bytes[index]);
        }
        return result;
    }
    async function detectImageFormat(blob) {
        if (!(blob instanceof Blob) || blob.size < 6) {
            throw new Error("표지 이미지 파일이 비어 있거나 올바르지 않습니다.");
        }
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        if (head.length >= 3 &&
            head[0] === 0xff &&
            head[1] === 0xd8 &&
            head[2] === 0xff) {
            return { extension: "jpg", mimeType: "image/jpeg", label: "JPEG" };
        }
        if (head.length >= 8 &&
            head[0] === 0x89 &&
            head[1] === 0x50 &&
            head[2] === 0x4e &&
            head[3] === 0x47 &&
            head[4] === 0x0d &&
            head[5] === 0x0a &&
            head[6] === 0x1a &&
            head[7] === 0x0a) {
            return { extension: "png", mimeType: "image/png", label: "PNG" };
        }
        const gifSignature = readAscii(head, 0, 6);
        if (gifSignature === "GIF87a" || gifSignature === "GIF89a") {
            return { extension: "gif", mimeType: "image/gif", label: "GIF" };
        }
        throw new Error("표지 이미지는 실제 JPEG, PNG 또는 GIF 파일이어야 합니다.");
    }
    function normalizeArchivePath(rawName) {
        const segments = String(rawName || "")
            .replace(/\\/g, "/")
            .split("/")
            .map((segment) => segment
            .replace(/[\u0000-\u001f\u007f]/g, "_")
            .replace(/^\.+$/, "_")
            .trim())
            .filter((segment) => segment && segment !== "." && segment !== "..");
        return segments.join("/") || "file";
    }
    function splitArchiveName(name) {
        const slashIndex = name.lastIndexOf("/");
        const directory = slashIndex >= 0 ? name.slice(0, slashIndex + 1) : "";
        const leaf = slashIndex >= 0 ? name.slice(slashIndex + 1) : name;
        const dotIndex = leaf.lastIndexOf(".");
        if (dotIndex <= 0) {
            return { directory, stem: leaf || "file", extension: "" };
        }
        return {
            directory,
            stem: leaf.slice(0, dotIndex) || "file",
            extension: leaf.slice(dotIndex)
        };
    }
    function makeUniqueArchiveName(rawName, usedNames, nextSequences) {
        const normalized = normalizeArchivePath(rawName);
        const key = normalized.toLocaleLowerCase("en-US");
        if (!usedNames.has(key)) {
            usedNames.add(key);
            return normalized;
        }
        const parts = splitArchiveName(normalized);
        for (let sequence = nextSequences.get(key) ?? 2; sequence <= MAX_UINT16; sequence += 1) {
            const candidate = `${parts.directory}${parts.stem}_${sequence}${parts.extension}`;
            const candidateKey = candidate.toLocaleLowerCase("en-US");
            if (!usedNames.has(candidateKey)) {
                usedNames.add(candidateKey);
                nextSequences.set(key, sequence + 1);
                return candidate;
            }
        }
        throw new Error(`중복 파일 이름을 안전하게 구분하지 못했습니다: ${normalized}`);
    }
    function makeArchiveNames(files) {
        const usedNames = new Set();
        const nextSequences = new Map();
        return files.map((file) => {
            const preferredName = String(file.webkitRelativePath || file.name || "file");
            return makeUniqueArchiveName(preferredName, usedNames, nextSequences);
        });
    }
    function toDosDateTime(timestamp) {
        const input = Number.isFinite(Number(timestamp)) ? new Date(Number(timestamp)) : new Date();
        const year = Math.min(2107, Math.max(1980, input.getFullYear()));
        const month = Math.min(12, Math.max(1, input.getMonth() + 1));
        const day = Math.min(31, Math.max(1, input.getDate()));
        const hours = Math.min(23, Math.max(0, input.getHours()));
        const minutes = Math.min(59, Math.max(0, input.getMinutes()));
        const seconds = Math.min(59, Math.max(0, input.getSeconds()));
        return {
            dosDate: ((year - 1980) << 9) | (month << 5) | day,
            dosTime: (hours << 11) | (minutes << 5) | Math.floor(seconds / 2)
        };
    }
    function updateCrc32(crc, bytes) {
        let current = crc >>> 0;
        for (let index = 0; index < bytes.length; index += 1) {
            current = crc32Table[(current ^ bytes[index]) & 0xff] ^ (current >>> 8);
        }
        return current >>> 0;
    }
    async function computeFileCrc32(file, onChunk, signal) {
        let crc = 0xffffffff;
        // Bound temporary buffers even when a platform lacks Blob.stream(). A task
        // boundary between chunks lets the UI paint and deliver Cancel promptly.
        const chunkSize = 1024 * 1024;
        signal?.throwIfAborted();
        for (let offset = 0; offset < file.size; offset += chunkSize) {
            signal?.throwIfAborted();
            const bytes = new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer());
            signal?.throwIfAborted();
            crc = updateCrc32(crc, bytes);
            onChunk(bytes.byteLength);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        signal?.throwIfAborted();
        return (crc ^ 0xffffffff) >>> 0;
    }
    function assertZip32Value(value, label) {
        if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
            throw new Error(`${label}이 ZIP32 형식의 최대 크기를 넘었습니다.`);
        }
    }
    function makeLocalHeader(entry) {
        const output = new Uint8Array(30 + entry.nameBytes.length);
        const view = new DataView(output.buffer);
        writeUint32(view, 0, LOCAL_HEADER_SIGNATURE);
        writeUint16(view, 4, ZIP_VERSION_20);
        writeUint16(view, 6, UTF8_FLAG);
        writeUint16(view, 8, 0);
        writeUint16(view, 10, entry.dosTime);
        writeUint16(view, 12, entry.dosDate);
        writeUint32(view, 14, entry.crc32);
        writeUint32(view, 18, entry.file.size);
        writeUint32(view, 22, entry.file.size);
        writeUint16(view, 26, entry.nameBytes.length);
        writeUint16(view, 28, 0);
        output.set(entry.nameBytes, 30);
        return output;
    }
    function makeCentralHeader(entry) {
        const output = new Uint8Array(46 + entry.nameBytes.length);
        const view = new DataView(output.buffer);
        writeUint32(view, 0, CENTRAL_HEADER_SIGNATURE);
        writeUint16(view, 4, ZIP_VERSION_20);
        writeUint16(view, 6, ZIP_VERSION_20);
        writeUint16(view, 8, UTF8_FLAG);
        writeUint16(view, 10, 0);
        writeUint16(view, 12, entry.dosTime);
        writeUint16(view, 14, entry.dosDate);
        writeUint32(view, 16, entry.crc32);
        writeUint32(view, 20, entry.file.size);
        writeUint32(view, 24, entry.file.size);
        writeUint16(view, 28, entry.nameBytes.length);
        writeUint16(view, 30, 0);
        writeUint16(view, 32, 0);
        writeUint16(view, 34, 0);
        writeUint16(view, 36, 0);
        writeUint32(view, 38, 0);
        writeUint32(view, 42, entry.localHeaderOffset);
        output.set(entry.nameBytes, 46);
        return output;
    }
    function makeEndOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
        const output = new Uint8Array(22);
        const view = new DataView(output.buffer);
        writeUint32(view, 0, EOCD_SIGNATURE);
        writeUint16(view, 4, 0);
        writeUint16(view, 6, 0);
        writeUint16(view, 8, entryCount);
        writeUint16(view, 10, entryCount);
        writeUint32(view, 12, centralDirectorySize);
        writeUint32(view, 16, centralDirectoryOffset);
        writeUint16(view, 20, 0);
        return output;
    }
    async function verifyImageArchive(blob, coverSize, expectedEntryCount) {
        if (blob.size < coverSize + 22) {
            throw new Error("생성된 파일의 크기가 예상보다 작습니다.");
        }
        const tail = new Uint8Array(await blob.slice(blob.size - 22).arrayBuffer());
        const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
        if (tailView.getUint32(0, true) !== EOCD_SIGNATURE) {
            throw new Error("생성된 파일에서 ZIP 종료 레코드를 확인하지 못했습니다.");
        }
        const entryCount = tailView.getUint16(10, true);
        const centralDirectorySize = tailView.getUint32(12, true);
        const centralDirectoryOffset = tailView.getUint32(16, true);
        if (entryCount !== expectedEntryCount) {
            throw new Error("생성된 ZIP의 파일 개수가 선택한 파일 개수와 다릅니다.");
        }
        if (centralDirectoryOffset < coverSize ||
            centralDirectorySize < 46 ||
            centralDirectoryOffset + centralDirectorySize > blob.size - 22) {
            throw new Error("생성된 ZIP의 중앙 디렉터리 위치가 올바르지 않습니다.");
        }
        const centralSignatureBytes = new Uint8Array(await blob.slice(centralDirectoryOffset, centralDirectoryOffset + 4).arrayBuffer());
        const centralSignatureView = new DataView(centralSignatureBytes.buffer, centralSignatureBytes.byteOffset, centralSignatureBytes.byteLength);
        if (centralSignatureView.getUint32(0, true) !== CENTRAL_HEADER_SIGNATURE) {
            throw new Error("생성된 ZIP의 중앙 디렉터리 헤더를 확인하지 못했습니다.");
        }
        const localSignatureBytes = new Uint8Array(await blob.slice(coverSize, coverSize + 4).arrayBuffer());
        const localSignatureView = new DataView(localSignatureBytes.buffer, localSignatureBytes.byteOffset, localSignatureBytes.byteLength);
        if (localSignatureView.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
            throw new Error("생성된 ZIP의 첫 파일 헤더를 확인하지 못했습니다.");
        }
    }
    async function buildImageArchive(options) {
        const cover = options?.cover;
        const files = Array.isArray(options?.files) ? [...options.files] : [];
        const signal = options?.signal;
        signal?.throwIfAborted();
        const onProgress = typeof options?.onProgress === "function"
            ? options.onProgress
            : () => { };
        if (!(cover instanceof Blob)) {
            throw new Error("표지 이미지를 선택하십시오.");
        }
        if (files.length === 0) {
            throw new Error("이미지 안에 담을 파일을 한 개 이상 선택하십시오.");
        }
        if (files.length > MAX_UINT16) {
            throw new Error(`한 번에 담을 수 있는 파일은 최대 ${MAX_UINT16.toLocaleString()}개입니다.`);
        }
        const format = await detectImageFormat(cover);
        assertZip32Value(cover.size, "표지 이미지 크기");
        const archiveNames = makeArchiveNames(files);
        const archiveNameBytes = archiveNames.map((archiveName) => {
            const bytes = textEncoder.encode(archiveName);
            if (bytes.length === 0 || bytes.length > MAX_UINT16) {
                throw new Error(`ZIP 안에 저장할 파일 이름이 너무 깁니다: ${archiveName}`);
            }
            return bytes;
        });
        const totalBytes = files.reduce((sum, file, index) => {
            if (!(file instanceof Blob)) {
                throw new Error(`선택한 항목 ${index + 1}이 올바른 파일이 아닙니다.`);
            }
            assertZip32Value(file.size, `${file.name || `파일 ${index + 1}`} 크기`);
            return sum + Number(file.size || 0);
        }, 0);
        assertZip32Value(totalBytes, "선택한 파일의 총 크기");
        const estimatedOutputBytes = files.reduce((sum, file, index) => sum + file.size + 30 + 46 + archiveNameBytes[index].length * 2, cover.size + 22);
        assertZip32Value(estimatedOutputBytes, "예상 결과 파일 크기");
        let processedBytes = 0;
        const preparedEntries = [];
        for (let index = 0; index < files.length; index += 1) {
            if (index % 128 === 0)
                await new Promise(resolve => setTimeout(resolve, 0));
            signal?.throwIfAborted();
            const file = files[index];
            const archiveName = archiveNames[index];
            const nameBytes = archiveNameBytes[index];
            onProgress({
                phase: "hashing",
                processedBytes,
                totalBytes,
                currentFileName: archiveName,
                currentFileIndex: index,
                fileCount: files.length
            });
            const crc32 = await computeFileCrc32(file, (chunkBytes) => {
                processedBytes += chunkBytes;
                onProgress({
                    phase: "hashing",
                    processedBytes,
                    totalBytes,
                    currentFileName: archiveName,
                    currentFileIndex: index,
                    fileCount: files.length
                });
            }, signal);
            const dateTime = toDosDateTime(file.lastModified);
            preparedEntries.push({
                file,
                archiveName,
                nameBytes,
                crc32,
                localHeaderOffset: 0,
                dosDate: dateTime.dosDate,
                dosTime: dateTime.dosTime
            });
        }
        onProgress({
            phase: "building",
            processedBytes: totalBytes,
            totalBytes,
            currentFileName: "",
            currentFileIndex: files.length,
            fileCount: files.length
        });
        let currentOffset = cover.size;
        const localParts = [];
        for (const [index, entry] of preparedEntries.entries()) {
            if (index % 256 === 0)
                await new Promise(resolve => setTimeout(resolve, 0));
            signal?.throwIfAborted();
            entry.localHeaderOffset = currentOffset;
            assertZip32Value(entry.localHeaderOffset, `${entry.archiveName}의 ZIP 위치`);
            const header = makeLocalHeader(entry);
            localParts.push(header, entry.file);
            currentOffset += header.byteLength + entry.file.size;
            assertZip32Value(currentOffset, "ZIP 파일 데이터 끝 위치");
        }
        const centralDirectoryOffset = currentOffset;
        const centralParts = [];
        let centralDirectorySize = 0;
        for (const [index, entry] of preparedEntries.entries()) {
            if (index % 256 === 0)
                await new Promise(resolve => setTimeout(resolve, 0));
            signal?.throwIfAborted();
            const header = makeCentralHeader(entry);
            centralParts.push(header);
            centralDirectorySize += header.byteLength;
        }
        assertZip32Value(centralDirectoryOffset, "중앙 디렉터리 위치");
        assertZip32Value(centralDirectorySize, "중앙 디렉터리 크기");
        const endRecord = makeEndOfCentralDirectory(preparedEntries.length, centralDirectorySize, centralDirectoryOffset);
        const outputBytes = centralDirectoryOffset + centralDirectorySize + endRecord.byteLength;
        assertZip32Value(outputBytes, "최종 결과 파일 크기");
        const blob = new Blob([cover, ...localParts, ...centralParts, endRecord], { type: format.mimeType });
        onProgress({
            phase: "verifying",
            processedBytes: totalBytes,
            totalBytes,
            currentFileName: "",
            currentFileIndex: files.length,
            fileCount: files.length
        });
        await verifyImageArchive(blob, cover.size, preparedEntries.length);
        signal?.throwIfAborted();
        return {
            blob,
            format,
            entries: preparedEntries.map((entry) => ({
                archiveName: entry.archiveName,
                size: entry.file.size,
                crc32: entry.crc32
            })),
            coverBytes: cover.size,
            archiveBytes: blob.size - cover.size,
            outputBytes: blob.size
        };
    }
    globalThis.FileToImageCore = Object.freeze({
        detectImageFormat,
        buildImageArchive,
        verifyImageArchive
    });
})();
