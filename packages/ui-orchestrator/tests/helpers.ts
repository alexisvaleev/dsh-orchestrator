/** Minimal local stand-ins for the harness's test-runtime helpers, which are not shipped to npm. */

/** Dictionary lookup with `{name}` interpolation matching the client locale contract. */
export function makeTranslate(
  ...dicts: readonly Record<string, string>[]
): (key: string, params?: Record<string, unknown>) => string {
  return (key, params) => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) {
        template = hit
        break
      }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }
}

/** A minimal `locale` service: register/bind/setLocale with dictionary withdrawal on dispose. */
export function fakeLocale() {
  let current = 'en'
  const dicts = new Map<string, Map<string, Record<string, string>>>()
  return {
    setLocale: (locale: string) => { current = locale },
    register: (ns: string, provided: Record<string, Record<string, string>>) => {
      const perNs = dicts.get(ns) ?? new Map<string, Record<string, string>>()
      for (const [locale, dict] of Object.entries(provided)) perNs.set(locale, dict)
      dicts.set(ns, perNs)
      return () => { dicts.delete(ns) }
    },
    bind: (ns: string) => (key: string, params?: Record<string, unknown>) => {
      const dict = dicts.get(ns)?.get(current)
      const template = dict?.[key] ?? key
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match)
    },
  }
}
