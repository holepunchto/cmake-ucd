const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  constants: { CODE_POINTS },
  blocks,
  codePoints,
  entryBlocks,
  hex,
  open,
  pool,
  range,
  rangeBlocks,
  ranges,
  table
} = require('.')

test('range parses a single code point and an inclusive range', (t) => {
  t.alike(range('0041'), [0x41, 0x41])
  t.alike(range('0041..005A'), [0x41, 0x5a])
  t.alike(range('10FFFF'), [0x10ffff, 0x10ffff])
})

test('codePoints parses a sequence, and nothing at all', (t) => {
  t.alike(codePoints(''), [])
  t.alike(codePoints('0041'), [0x41])
  t.alike(codePoints('0041 0301 10348'), [0x41, 0x301, 0x10348])
})

test('ranges compresses runs and loses nothing', (t) => {
  const property = new Uint8Array(CODE_POINTS)

  property.fill(1, 0x100, 0x200)
  property.fill(2, 0x200, 0x201)
  property.fill(3, 0x10000, CODE_POINTS)

  const compressed = ranges(property)

  t.alike(compressed.slice(0, 5), [
    [0, 0],
    [0x100, 1],
    [0x200, 2],
    [0x201, 0],
    [0x10000, 3]
  ])

  let unsorted = null

  for (let i = 1; i < compressed.length; i++) {
    if (compressed[i][0] <= compressed[i - 1][0]) {
      unsorted = { at: i, previous: hex(compressed[i - 1][0]), start: hex(compressed[i][0]) }
      break
    }
  }

  t.is(unsorted, null, 'the ranges are sorted and gap-free')

  // Walking the ranges must reconstruct the input exactly. Every code point is
  // checked, but as a single assertion; a million of them would be a million
  // recorded ones.
  let differs = null
  let at = 0

  for (let c = 0; c < CODE_POINTS; c++) {
    if (at + 1 < compressed.length && compressed[at + 1][0] <= c) at++

    if (compressed[at][1] !== property[c]) {
      differs = { codePoint: hex(c), got: compressed[at][1], expected: property[c] }
      break
    }
  }

  t.is(differs, null, 'the ranges reconstruct the property of every code point')
})

// The lookup that the generated C tables are read with, narrowed to a block and
// then searched within it. This mirrors the search in the consuming library, so a
// wrong index here is a wrong answer there.
function lookup(compressed, indexes, shift, c) {
  const block = c >> shift

  let lo = indexes[block]
  let hi = indexes[block + 1]

  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo + 1) / 2)

    if (compressed[mid][0] <= c) lo = mid
    else hi = mid - 1
  }

  return compressed[lo][1]
}

test('rangeBlocks narrows a search that still finds every code point', (t) => {
  // A deterministic spread of values, with runs both far shorter and far longer
  // than a block.
  const property = new Uint8Array(CODE_POINTS)

  let value = 0

  for (let c = 0, step = 1; c < CODE_POINTS; c += step) {
    value = (value + 7) & 0xff
    step = 1 + ((c >> 5) % 977)

    property.fill(value, c, Math.min(c + step, CODE_POINTS))
  }

  const compressed = ranges(property)
  const starts = compressed.map(([start]) => start)

  for (const shift of [7, 9, 12]) {
    const indexes = rangeBlocks(starts, shift)

    t.is(indexes.length, blocks(shift), `shift ${shift} indexes every block`)

    // A block boundary is exactly where an off-by-one hides, so no code point is
    // sampled over.
    let differs = null

    for (let c = 0; c < CODE_POINTS; c++) {
      if (lookup(compressed, indexes, shift, c) !== property[c]) {
        differs = { codePoint: hex(c), expected: property[c] }
        break
      }
    }

    t.is(differs, null, `shift ${shift} looks up every code point`)
  }
})

test('entryBlocks bounds the entries of every block', (t) => {
  const points = []

  for (let c = 0; c < CODE_POINTS; c += 1 + (c % 1319)) points.push(c)

  for (const shift of [7, 9, 12]) {
    const indexes = entryBlocks(points, shift)

    t.is(indexes.length, blocks(shift), `shift ${shift} indexes every block`)

    let outside = null

    for (let b = 0; b + 1 < indexes.length && outside === null; b++) {
      const start = b << shift
      const end = start + (1 << shift)

      // Everything before the block's index sits below it, and what lies between
      // its index and the next block's is exactly the block's own.
      if (indexes[b] > 0 && points[indexes[b] - 1] >= start) {
        outside = { block: b, before: hex(points[indexes[b] - 1]) }
        break
      }

      for (let i = indexes[b]; i < indexes[b + 1]; i++) {
        if (points[i] < start || points[i] >= end) {
          outside = { block: b, entry: i, codePoint: hex(points[i]) }
          break
        }
      }
    }

    t.is(outside, null, `shift ${shift} bounds every block`)
  }
})

test('pool shares identical sequences and keeps distinct ones apart', (t) => {
  const p = pool()

  const a = p.add([0x61, 0x62])
  const b = p.add([0x63])
  const c = p.add([0x61, 0x62])

  t.is(a, 0)
  t.is(b, 2)
  t.is(c, a, 'an identical sequence is shared')
  t.alike(p.data, [0x61, 0x62, 0x63])

  // A sequence that is a prefix of one already pooled is still its own entry, the
  // pool keying on the whole of it.
  t.is(p.add([0x61]), 3)
  t.alike(p.data, [0x61, 0x62, 0x63, 0x61])

  t.is(p.add([]), 4, 'an empty sequence takes the offset past the end')
})

test('hex and table format as the generated sources expect', (t) => {
  t.is(hex(0), '0x0')
  t.is(hex(0x10ffff), '0x10ffff')

  t.is(table(['1', '2', '3'], 2), '  1, 2,\n  3,\n')
  t.is(table([], 4), '')
})

test('open reads data lines, missing annotations and properties', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-ucd-'))

  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))

  fs.writeFileSync(
    path.join(dir, 'Derived.txt'),
    [
      '# @missing: 0000..10FFFF; Other_Neutral',
      '# @missing: 0600..06FF; Arabic_Letter',
      '',
      '0041..005A ; Left_To_Right # a comment',
      '0660..0669 ; Arabic_Number',
      '# a comment line on its own'
    ].join('\n')
  )

  const ucd = open(dir)

  t.alike(
    [...ucd.lines('Derived.txt')],
    [
      ['0041..005A', 'Left_To_Right'],
      ['0660..0669', 'Arabic_Number']
    ]
  )

  t.alike(
    [...ucd.missing('Derived.txt')],
    [
      ['0000..10FFFF', 'Other_Neutral'],
      ['0600..06FF', 'Arabic_Letter']
    ]
  )

  const values = { Left_To_Right: 1, Arabic_Letter: 3, Arabic_Number: 4, Other_Neutral: 9 }

  const property = ucd.property('Derived.txt', values, 0)

  // The later annotation wins over the earlier one where the two overlap.
  t.is(property[0x0000], 9)
  t.is(property[0x0600], 3)
  t.is(property[0x06ff], 3)
  t.is(property[0x0700], 9)

  // A listed range overrides whatever the annotations gave it.
  t.is(property[0x0041], 1)
  t.is(property[0x005a], 1)
  t.is(property[0x005b], 9)
  t.is(property[0x0660], 4)
  t.is(property[0x0669], 4)
  t.is(property[0x066a], 3)
})

test('a value the caller has no interest in falls back', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-ucd-'))

  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))

  fs.writeFileSync(path.join(dir, 'Derived.txt'), '0041 ; Kept\n0042 ; Dropped\n')

  const property = open(dir).property('Derived.txt', { Kept: 5 }, 0)

  t.is(property[0x41], 5)
  t.is(property[0x42], 0, 'an unlisted value takes the fallback')
})

require('./test/fetch.js')
