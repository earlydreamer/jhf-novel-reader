// Read metadata and verify the file; never loads the model or prints a tokenizer vocabulary.
import { openSync, readSync, closeSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const filename = process.argv[2];
if (!filename) throw new Error('Usage: node inspect-gguf.mjs model.gguf');
const fd = openSync(filename, 'r');
let offset = 0;
const read = (size) => {
  const value = Buffer.alloc(size);
  if (readSync(fd, value, 0, size, offset) !== size) throw new Error('Unexpected EOF');
  offset += size;
  return value;
};
const uint32 = () => read(4).readUInt32LE();
const uint64 = () => {
  const value = Number(read(8).readBigUInt64LE());
  if (!Number.isSafeInteger(value)) throw new Error('Unsafe metadata size');
  return value;
};
const string = (keep) => {
  const length = uint64();
  if (length > 32_000_000) throw new Error('Oversized metadata string');
  if (keep) return read(length).toString('utf8');
  offset += length;
};
const scalarSizes = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
function value(type, keep) {
  if (type === 8) return string(keep);
  if (type === 9) {
    const element = uint32(),
      length = uint64();
    if (length > 2_000_000) throw new Error('Oversized metadata array');
    if (scalarSizes[element]) offset += scalarSizes[element] * length;
    else for (let i = 0; i < length; i++) value(element, false);
    return { elements: length };
  }
  const size = scalarSizes[type];
  if (!size) throw new Error('Unknown metadata type');
  const bytes = read(size);
  if (!keep) return;
  switch (type) {
    case 0:
      return bytes.readUInt8();
    case 1:
      return bytes.readInt8();
    case 2:
      return bytes.readUInt16LE();
    case 3:
      return bytes.readInt16LE();
    case 4:
      return bytes.readUInt32LE();
    case 5:
      return bytes.readInt32LE();
    case 6:
      return bytes.readFloatLE();
    case 7:
      return Boolean(bytes.readUInt8());
    case 10:
      return uintToNumber(bytes.readBigUInt64LE());
    case 11:
      return uintToNumber(bytes.readBigInt64LE());
    case 12:
      return bytes.readDoubleLE();
  }
}
function uintToNumber(n) {
  const number = Number(n);
  return Number.isSafeInteger(number) ? number : n.toString();
}
const result = { bytes: statSync(filename).size, metadata: {} };
try {
  if (read(4).toString('ascii') !== 'GGUF') throw new Error('Invalid GGUF magic');
  result.version = uint32();
  if (result.version !== 3) throw new Error('Expected GGUF version 3');
  result.tensors = uint64();
  result.metadataEntries = uint64();
  if (result.metadataEntries > 10000) throw new Error('Oversized metadata');
  for (let i = 0; i < result.metadataEntries; i++) {
    const key = string(true),
      type = uint32();
    const keep =
      /^(general\.(name|architecture|file_type|quantization_version)|tokenizer\.chat_template|tokenizer\.ggml\.(model|eos_token_id|bos_token_id|add_bos_token|add_eos_token)|[a-z_]+\.context_length)$/.test(
        key,
      );
    const item = value(type, keep);
    if (keep) result.metadata[key] = item;
  }
} finally {
  closeSync(fd);
}
const digest = createHash('sha256');
for await (const chunk of createReadStream(filename)) digest.update(chunk);
result.sha256 = digest.digest('hex');
const template = result.metadata['tokenizer.chat_template'];
if (typeof template === 'string') {
  result.metadata['tokenizer.chat_template'] = {
    chars: template.length,
    sha256: createHash('sha256').update(template).digest('hex'),
  };
  const officialResponse = await fetch(
    'https://huggingface.co/tencent/Hy-MT2-7B/raw/9b0eb4e8f001def3e5ff6469a0ac96fdb39ec223/chat_template.jinja',
  );
  // A revision miss must be reported, never silently compared to a different file.
  result.templateReferenceHttpStatus = officialResponse.status;
  if (officialResponse.ok) {
    const official = await officialResponse.text();
    result.templateEqualsOfficial = template.trim() === official.trim();
  }
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
