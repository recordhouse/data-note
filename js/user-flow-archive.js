(() => {
  "use strict";

  if (window.UserFlowArchive) {
    return;
  }

  const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
  const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
  const ZIP_END_SIGNATURE = 0x06054b50;
  const ZIP_UTF8_FLAG = 0x0800;
  const ZIP_STORE_METHOD = 0;
  const ZIP_DEFLATE_METHOD = 8;
  const MAX_ZIP_ENTRIES = 500;
  const MAX_ZIP_BYTES = 50 * 1024 * 1024;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder("utf-8");
  const crcTable = createCrcTable();

  function createCrcTable() {
    return Array.from({ length: 256 }, (_, index) => {
      let value = index;

      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }

      return value >>> 0;
    });
  }

  function getCrc32(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  function toBytes(value) {
    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    return textEncoder.encode(String(value ?? ""));
  }

  function normalizeArchivePath(value, isDirectory = false) {
    const originalPath = String(value || "").replace(/\\/g, "/");

    if (!originalPath || originalPath.includes("\0") || originalPath.startsWith("/")) {
      throw new Error("압축 파일 경로가 올바르지 않습니다.");
    }

    const segments = originalPath.split("/").filter(Boolean);

    if (!segments.length || segments.some((segment) => segment === "..")) {
      throw new Error("압축 파일 경로가 올바르지 않습니다.");
    }

    const normalizedPath = segments.join("/");
    return isDirectory || originalPath.endsWith("/")
      ? `${normalizedPath}/`
      : normalizedPath;
  }

  function getDosDateTime(dateValue = Date.now()) {
    const date = new Date(dateValue);
    const year = Math.max(1980, date.getFullYear());

    return {
      date:
        ((year - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate(),
      time:
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        Math.floor(date.getSeconds() / 2),
    };
  }

  function createArchive(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      throw new Error("압축할 파일이 없습니다.");
    }

    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new Error(`압축 파일은 최대 ${MAX_ZIP_ENTRIES}개까지 담을 수 있습니다.`);
    }

    const localChunks = [];
    const centralRecords = [];
    let localOffset = 0;
    let totalDataBytes = 0;

    entries.forEach((entry) => {
      const isDirectory = Boolean(entry?.isDirectory);
      const name = normalizeArchivePath(entry?.name, isDirectory);
      const nameBytes = textEncoder.encode(name);
      const dataBytes = isDirectory ? new Uint8Array(0) : toBytes(entry?.data);

      if (nameBytes.length > 0xffff) {
        throw new Error("압축 파일 경로가 너무 깁니다.");
      }

      totalDataBytes += dataBytes.length;

      if (totalDataBytes > MAX_ZIP_BYTES) {
        throw new Error("내보낼 녹화 데이터가 너무 큽니다.");
      }

      const crc32 = getCrc32(dataBytes);
      const dos = getDosDateTime(entry?.modifiedAt);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(localHeader.buffer);

      localView.setUint32(0, ZIP_LOCAL_FILE_SIGNATURE, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, ZIP_UTF8_FLAG, true);
      localView.setUint16(8, ZIP_STORE_METHOD, true);
      localView.setUint16(10, dos.time, true);
      localView.setUint16(12, dos.date, true);
      localView.setUint32(14, crc32, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      localHeader.set(nameBytes, 30);
      localChunks.push(localHeader, dataBytes);
      centralRecords.push({
        crc32,
        dataLength: dataBytes.length,
        dos,
        isDirectory,
        localOffset,
        nameBytes,
      });
      localOffset += localHeader.length + dataBytes.length;
    });

    const centralChunks = [];
    let centralSize = 0;

    centralRecords.forEach((record) => {
      const centralHeader = new Uint8Array(46 + record.nameBytes.length);
      const centralView = new DataView(centralHeader.buffer);

      centralView.setUint32(0, ZIP_CENTRAL_FILE_SIGNATURE, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, ZIP_UTF8_FLAG, true);
      centralView.setUint16(10, ZIP_STORE_METHOD, true);
      centralView.setUint16(12, record.dos.time, true);
      centralView.setUint16(14, record.dos.date, true);
      centralView.setUint32(16, record.crc32, true);
      centralView.setUint32(20, record.dataLength, true);
      centralView.setUint32(24, record.dataLength, true);
      centralView.setUint16(28, record.nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, record.isDirectory ? 0x10 : 0, true);
      centralView.setUint32(42, record.localOffset, true);
      centralHeader.set(record.nameBytes, 46);
      centralChunks.push(centralHeader);
      centralSize += centralHeader.length;
    });

    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);

    endView.setUint32(0, ZIP_END_SIGNATURE, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, centralRecords.length, true);
    endView.setUint16(10, centralRecords.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localChunks, ...centralChunks, endHeader], {
      type: "application/zip",
    });
  }

  function findEndHeader(bytes) {
    const minimumOffset = Math.max(0, bytes.length - 0xffff - 22);

    for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
      if (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === ZIP_END_SIGNATURE) {
        return offset;
      }
    }

    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("이 브라우저에서는 압축된 ZIP 파일을 해제할 수 없습니다.");
    }

    try {
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      throw new Error("ZIP 압축 데이터를 해제하지 못했습니다.");
    }
  }

  async function readArchive(source) {
    const arrayBuffer =
      source instanceof ArrayBuffer
        ? source
        : source instanceof Uint8Array
          ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
          : await source.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length > MAX_ZIP_BYTES) {
      throw new Error("50MB 이하의 ZIP 파일만 가져올 수 있습니다.");
    }

    const endOffset = findEndHeader(bytes);

    if (endOffset < 0) {
      throw new Error("올바른 ZIP 파일이 아닙니다.");
    }

    const endView = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
    const diskNumber = endView.getUint16(4, true);
    const centralDisk = endView.getUint16(6, true);
    const entryCount = endView.getUint16(10, true);
    const centralSize = endView.getUint32(12, true);
    const centralOffset = endView.getUint32(16, true);

    if (
      diskNumber !== 0 ||
      centralDisk !== 0 ||
      entryCount > MAX_ZIP_ENTRIES ||
      centralOffset + centralSize > endOffset
    ) {
      throw new Error("지원하지 않는 ZIP 파일 형식입니다.");
    }

    const records = [];
    let cursor = centralOffset;
    let totalUncompressedBytes = 0;

    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > bytes.length) {
        throw new Error("ZIP 파일 목록이 손상되었습니다.");
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset + cursor, 46);

      if (view.getUint32(0, true) !== ZIP_CENTRAL_FILE_SIGNATURE) {
        throw new Error("ZIP 파일 목록이 손상되었습니다.");
      }

      const flags = view.getUint16(8, true);
      const method = view.getUint16(10, true);
      const crc32 = view.getUint32(16, true);
      const compressedSize = view.getUint32(20, true);
      const uncompressedSize = view.getUint32(24, true);
      const nameLength = view.getUint16(28, true);
      const extraLength = view.getUint16(30, true);
      const commentLength = view.getUint16(32, true);
      const localOffset = view.getUint32(42, true);
      const recordLength = 46 + nameLength + extraLength + commentLength;

      if (
        flags & 1 ||
        ![ZIP_STORE_METHOD, ZIP_DEFLATE_METHOD].includes(method) ||
        cursor + recordLength > bytes.length
      ) {
        throw new Error("지원하지 않는 ZIP 파일 항목이 있습니다.");
      }

      const rawName = textDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      const isDirectory = rawName.endsWith("/");
      const name = normalizeArchivePath(rawName, isDirectory);

      totalUncompressedBytes += uncompressedSize;

      if (totalUncompressedBytes > MAX_ZIP_BYTES) {
        throw new Error("압축 해제된 녹화 데이터가 너무 큽니다.");
      }

      records.push({
        compressedSize,
        crc32,
        isDirectory,
        localOffset,
        method,
        name,
        uncompressedSize,
      });
      cursor += recordLength;
    }

    const extractedEntries = [];

    for (const record of records) {
      if (record.localOffset + 30 > bytes.length) {
        throw new Error("ZIP 파일 데이터가 손상되었습니다.");
      }

      const localView = new DataView(
        bytes.buffer,
        bytes.byteOffset + record.localOffset,
        30,
      );

      if (localView.getUint32(0, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
        throw new Error("ZIP 파일 데이터가 손상되었습니다.");
      }

      const localNameLength = localView.getUint16(26, true);
      const localExtraLength = localView.getUint16(28, true);
      const dataOffset = record.localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataOffset + record.compressedSize;

      if (dataEnd > bytes.length) {
        throw new Error("ZIP 파일 데이터가 손상되었습니다.");
      }

      const compressedBytes = bytes.subarray(dataOffset, dataEnd);
      const data =
        record.method === ZIP_STORE_METHOD
          ? new Uint8Array(compressedBytes)
          : await inflateRaw(compressedBytes);

      if (
        data.length !== record.uncompressedSize ||
        getCrc32(data) !== record.crc32
      ) {
        throw new Error("ZIP 파일의 녹화 데이터가 손상되었습니다.");
      }

      extractedEntries.push({
        data,
        isDirectory: record.isDirectory,
        name: record.name,
        text: () => textDecoder.decode(data),
      });
    }

    return extractedEntries;
  }

  window.UserFlowArchive = Object.freeze({
    createArchive,
    readArchive,
  });
})();
