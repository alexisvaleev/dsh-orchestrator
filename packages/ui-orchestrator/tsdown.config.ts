import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'
import { transform } from 'lightningcss'

const ID = 'dsh-ui-orchestrator'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Emit one plugin-owned style injector and the CSS Modules class map. */
function styleInjectionModule(
  fileId: string,
  css: string,
  classMap: Readonly<Record<string, string>>,
): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${ID}/${fileId.split('/').pop()}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** Compile `*.module.css` imports into an injected style tag plus a class map. */
function cssModulesPlugin(): TsdownPlugin {
  return {
    name: 'dsh-css-modules',
    resolveId: {
      order: 'pre',
      handler(source, importer) {
        if (!source.endsWith('.module.css') || importer === undefined) return null
        const resolved = importer.startsWith('\0')
          ? resolvePath(importer.replace(/^\0[^:]+:/, ''), '..', source)
          : resolvePath(dirname(importer), source)
        // tsc does not copy stylesheets; lib/types imports resolve back to src.
        const file = resolved.replace(/\/lib\/types\//, '/src/')
        return { id: `${file}${CSS_VIRTUAL_SUFFIX}` }
      },
    },
    load: {
      order: 'pre',
      async handler(id) {
        if (!id.endsWith(CSS_VIRTUAL_SUFFIX)) return null
        const file = id.slice(0, -CSS_VIRTUAL_SUFFIX.length)
        const source = await readFile(file)
        const { code, exports } = transform({
          filename: file,
          code: source,
          cssModules: true,
          minify: true,
        })
        const classMap = Object.fromEntries(
          Object.entries(exports ?? {}).map(([name, value]) => [name, value.name]),
        )
        return styleInjectionModule(file, code.toString(), classMap)
      },
    },
  }
}

const EXTERNS = [
  /^react(\/.*)?$/,
  /^react-dom(\/.*)?$/,
  /^@deepseek-ai\/cordis$/,
  /^@deepseek-ai\/dsh-client-store$/,
  /^@deepseek-ai\/dsh-client-ui-slots$/,
  /^@deepseek-ai\/dsh-client-ui-primitives$/,
]

export default defineConfig([
  {
    name: `${ID}/node`,
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: spec => EXTERNS.some(re => re.test(spec)) || /^dsh-/.test(spec) },
  },
  {
    name: `${ID}/client`,
    entry: ['lib/types/client/index.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: spec => EXTERNS.some(re => re.test(spec)),
      alwaysBundle: spec => !spec.startsWith('node:') && !EXTERNS.some(re => re.test(spec)),
    },
    plugins: [cssModulesPlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      chunkFileNames: 'client.[name].js',
      banner: chunk =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, ${chunk.isEntry ? '' : `chunk: ${JSON.stringify(chunk.fileName)}, `}factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
