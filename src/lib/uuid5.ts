// Minigraf turns a keyword entity like `:alice` into a stable UUID:
// `Uuid::new_v5(&Uuid::NAMESPACE_OID, ":alice".as_bytes())`.
// We compute the same UUID here so the visualizer can link keyword values
// (`[:alice :friend :bob]`) to the entities they name. This runs for every
// keyword value in a database, so it is synchronous and has no dependencies.

const NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/-/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

const NS_BYTES = hexToBytes(NAMESPACE_OID);

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** SHA-1 digest of a byte array. Returns 20 bytes. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length;
  const withPadding = ((ml + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(withPadding);
  buf.set(bytes);
  buf[ml] = 0x80;
  const view = new DataView(buf.buffer);
  // Message length in bits, as a 64-bit big-endian integer.
  view.setUint32(withPadding - 8, Math.floor((ml * 8) / 2 ** 32));
  view.setUint32(withPadding - 4, (ml * 8) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let off = 0; off < withPadding; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h));
  return out;
}

const encoder = new TextEncoder();
const cache = new Map<string, string>();

/** UUID v5 of `name` in the OID namespace, formatted lowercase with hyphens. */
export function uuidV5Oid(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const nameBytes = encoder.encode(name);
  const input = new Uint8Array(NS_BYTES.length + nameBytes.length);
  input.set(NS_BYTES);
  input.set(nameBytes, NS_BYTES.length);
  const hash = sha1(input).slice(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  cache.set(name, uuid);
  return uuid;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * The entity id Minigraf uses for a keyword in entity position.
 * A keyword that is itself a UUID (`:550e8400-...`) maps to that UUID.
 */
export function keywordToEntityId(keyword: string): string {
  const bare = keyword.startsWith(":") ? keyword.slice(1) : keyword;
  if (isUuid(bare)) return bare.toLowerCase();
  return uuidV5Oid(keyword.startsWith(":") ? keyword : `:${keyword}`);
}
