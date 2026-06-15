// La librería userland 'punycode' (MIT, 2.x) no incluye declaraciones de tipos.
declare module 'punycode/punycode.js' {
  export function toUnicode(domain: string): string;
  export function toASCII(domain: string): string;
}
