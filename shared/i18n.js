import { getText } from "@zos/i18n";

// Translated string from page/i18n/*.po; "{0}", "{1}"… are replaced by the arguments
export function t(key, ...args) {
  return args.reduce((s, a, i) => s.replace(`{${i}}`, String(a)), getText(key));
}
