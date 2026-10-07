
// 随手记加密：Web Crypto AES-256-GCM + PBKDF2-SHA256（210000 次迭代）
// 密码仅存渲染层内存；存储层只有密文与随机 salt/iv

export interface NoteCipher {
  salt: string
  iv: string
  data: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const PBKDF2_ITERATIONS = 210_000

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptText(password: string, plaintext: string): Promise<NoteCipher> {
  if (!password) throw new Error('加密密码不能为空')
  if (!plaintext) throw new Error('加密内容不能为空')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    textEncoder.encode(plaintext) as BufferSource,
  )
  return { salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) }
}

export async function decryptText(password: string, cipher: NoteCipher): Promise<string> {
  if (!password) throw new Error('解密密码不能为空')
  const key = await deriveKey(password, fromBase64(cipher.salt))
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(cipher.iv) as BufferSource },
      key,
      fromBase64(cipher.data) as BufferSource,
    )
    return textDecoder.decode(plain)
  } catch {
    throw new Error('解密失败：密码错误或数据已损坏')
  }
}