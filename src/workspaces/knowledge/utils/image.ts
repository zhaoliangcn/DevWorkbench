/**
 * ArrayBuffer → base64（附录 E E.3.5 粘贴图片）。
 * 分块拼接避免 String.fromCharCode(...bytes) 在大文件上栈溢出；
 * 不用 Buffer —— renderer 环境无 Node Buffer，btoa 是浏览器标准。
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 按附件扩展名推断 dataURL 的 MIME（缺省 png） */
export function mimeFromPath(path: string): string {
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.webp$/i.test(path)) return 'image/webp'
  if (/\.svg$/i.test(path)) return 'image/svg+xml'
  return 'image/png'
}
