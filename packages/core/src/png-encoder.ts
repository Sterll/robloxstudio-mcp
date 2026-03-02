import { deflateSync, crc32 } from 'zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function writeChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(crcInput) >>> 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

export function rgbaToPng(rgba: Buffer, width: number, height: number): Buffer {
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    filtered[y * (1 + stride)] = 0; // filter type: None
    rgba.copy(filtered, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', deflateSync(filtered)),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
}
