// Detect signature markers before allowing edits; this does not verify signatures.
export function containsDigitalSignature(data: Uint8Array): boolean {
  const decoder = new TextDecoder('latin1')
  const chunkSize = 64 * 1024
  let hasByteRange = false
  let hasSignatureType = false
  for (
    let offset = 0;
    offset < data.length && !(hasByteRange && hasSignatureType);
    offset += chunkSize
  ) {
    const sample = decoder.decode(data.subarray(Math.max(0, offset - 128), offset + chunkSize))
    hasByteRange ||= /\/ByteRange\s*\[/.test(sample)
    hasSignatureType ||= /\/(?:FT|Type)\s*\/Sig\b/.test(sample)
  }
  return hasByteRange && hasSignatureType
}
