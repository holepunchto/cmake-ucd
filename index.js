// Helpers for reading the Unicode Character Database and turning it into the
// character tables of a C library, as documented in
// <https://www.unicode.org/reports/tr44>.
//
// The data files themselves are fetched by the CMake module beside this, which
// hands the directory holding them to a generator script for `open()` below.

const fs = require('fs')
const path = require('path')

const MAX_CODE_POINT = 0x10ffff
const CODE_POINTS = MAX_CODE_POINT + 1

exports.constants = { MAX_CODE_POINT, CODE_POINTS }

/**
 * Parses a code point or an inclusive range of code points, such as `0041` or
 * `0041..005A`, as the field of a data file gives it.
 */
function range(field) {
  const [start, end = start] = field.split('..')

  return [parseInt(start, 16), parseInt(end, 16)]
}

exports.range = range

/**
 * Parses a space separated sequence of code points, such as the mapping of an
 * entry, which is empty for an entry that maps to nothing.
 */
exports.codePoints = function codePoints(field) {
  if (field === '') return []

  return field.split(' ').map((code) => parseInt(code, 16))
}

/**
 * Opens a directory of data files, giving the readers that need to know where the
 * files are. The pure helpers below take their data as arguments and so stand on
 * their own.
 */
exports.open = function open(dir) {
  function read(file) {
    return fs.readFileSync(path.join(dir, file), 'utf8')
  }

  // Iterates the data lines of a file, stripping comments and yielding the
  // semicolon separated fields of each line.
  function* lines(file) {
    for (const line of read(file).split('\n')) {
      const data = line.split('#')[0].trim()

      if (data === '') continue

      yield data.split(';').map((field) => field.trim())
    }
  }

  // Iterates the `@missing` annotations of a file, which give the values of the
  // code points that the file leaves unlisted.
  function* missing(file) {
    for (const line of read(file).split('\n')) {
      const match = line.match(/^#\s*@missing:\s*([^;]+);\s*(.+?)\s*$/)

      if (match !== null) yield [match[1].trim(), match[2].trim()]
    }
  }

  // Reads a file of the extracted properties into an array holding the value of
  // every code point. `values` maps the names that the file uses to the values to
  // store, and a code point whose name is absent from it takes `fallback`, which
  // is how the values that a caller has no interest in are lumped together.
  function property(file, values, fallback) {
    const property = new Uint8Array(CODE_POINTS).fill(fallback)

    // The `@missing` annotations are ordered from least to most specific, with
    // later ones overriding earlier ones.
    for (const [codes, value] of missing(file)) {
      if (!(value in values)) continue

      const [start, end] = range(codes)

      property.fill(values[value], start, end + 1)
    }

    for (const [codes, value] of lines(file)) {
      const [start, end] = range(codes)

      property.fill(value in values ? values[value] : fallback, start, end + 1)
    }

    return property
  }

  return { read, lines, missing, property }
}

/**
 * Compresses an array holding the value of every code point into a sorted,
 * gap-free list of `[start, value]` pairs, each extending up to the start of the
 * pair that follows it. How the pairs are then packed into a table is left to the
 * caller, the room that a value needs being its own to know.
 */
exports.ranges = function ranges(property) {
  const ranges = []

  for (let c = 0; c < CODE_POINTS; c++) {
    if (c === 0 || property[c] !== property[c - 1]) {
      ranges.push([c, property[c]])
    }
  }

  return ranges
}

/**
 * The number of blocks that a code point splits into, given the number of low bits
 * of it that a block index leaves to the search it narrows down.
 */
function blocks(shift) {
  return (CODE_POINTS >> shift) + 1
}

exports.blocks = blocks

/**
 * Indexes a sorted, gap-free list of ranges by block, each entry giving the range
 * that covers the first code point of the block. The range covering any code point
 * of a block therefore lies between the entries of that block and the one after
 * it, which is a far narrower search than the whole table.
 */
exports.rangeBlocks = function rangeBlocks(starts, shift) {
  const indexes = []

  for (let b = 0, i = 0, n = exports.blocks(shift); b < n; b++) {
    const start = b << shift

    while (i + 1 < starts.length && starts[i + 1] <= start) i++

    indexes.push(i)
  }

  return indexes
}

/**
 * Indexes a list of entries sorted by code point, each entry giving the first
 * entry of the block, so that a block holds the entries from its own index up to
 * that of the block after it.
 */
exports.entryBlocks = function entryBlocks(codePoints, shift) {
  const indexes = []

  for (let b = 0, i = 0, n = blocks(shift); b < n; b++) {
    const start = b << shift

    while (i < codePoints.length && codePoints[i] < start) i++

    indexes.push(i)
  }

  return indexes
}

/**
 * A pool of code point sequences that the entries of a table refer to by offset
 * and length. Identical sequences are shared, a mapping table holding a great many
 * of the same few.
 */
exports.pool = function pool() {
  const data = []
  const offsets = new Map()

  return {
    data,
    add(sequence) {
      const key = sequence.join(' ')

      let offset = offsets.get(key)

      if (offset === undefined) {
        offset = data.length

        offsets.set(key, offset)

        data.push(...sequence)
      }

      return offset
    }
  }
}

exports.hex = function hex(value) {
  return `0x${value.toString(16)}`
}

/**
 * Wraps a list of already formatted entries across as many lines as needed.
 */
exports.table = function table(entries, perLine) {
  let out = ''

  for (let i = 0; i < entries.length; i += perLine) {
    out += `  ${entries.slice(i, i + perLine).join(', ')},\n`
  }

  return out
}
