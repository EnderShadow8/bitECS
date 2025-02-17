import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync } from 'fs'
import glob from 'globby'
import jsdoc2md from 'jsdoc-to-markdown'

const FILENAME = 'API.md'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function render (pattern, output) {
  const files = await glob([
    pattern,
    '!**/**/node_modules',
    '!**/**/test',
    '!**/**/examples',
  ])
  const md = await jsdoc2md.render({
    files,
    plugin: 'dmd-readable'
  })
  writeFileSync(output, md)
}

async function build () {
  await render('src/**/*.js', join(__dirname, '../docs', FILENAME))
}

build().catch(console.error)
