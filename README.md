# cmake-ucd

```
npm i cmake-ucd
```

```cmake
find_package(cmake-ucd REQUIRED PATHS node_modules/cmake-ucd)
```

Fetches the [Unicode Character Database](https://www.unicode.org/reports/tr44) at configure time and provides the helpers for turning it into the character tables of a C library.

## API

### CMake

#### `ucd_version`

The version of the database to fetch, as a cache variable, so that every project of a build agrees on it.

#### `ucd_data`

The directory that fetched files are written to, in the top-level build tree.

#### `ucd_fetch(<collection> <names>... [PATHS <variable>])`

Fetches the named files of a collection, appending their absolute paths to the variable named by `PATHS`. A file already fetched is left alone, the data of a released version never changing.

The collection names the part of [`unicode.org/Public`](https://www.unicode.org/Public) to take the files from:

| Collection  | Holds                                                        |
| ----------- | ------------------------------------------------------------ |
| `UCD`       | The character database proper, such as `UnicodeData.txt`     |
| `EXTRACTED` | Properties extracted from it, such as `DerivedBidiClass.txt` |
| `IDNA`      | The IDNA data, such as `IdnaMappingTable.txt`                |

The IDNA data is versioned separately and is not always given a directory of its own version: as of Unicode 17.0.0 the numbered directories stop at 16.0.0 while the 17.0.0 data is published under `latest`. Both are therefore tried, and a file taken from `latest` is checked to declare the version that was asked for rather than trusted to be it. Asking for a version that no published data holds is an error rather than a silent substitution.

### JavaScript

```js
const { open, ranges, rangeBlocks, pool, hex, table } = require('cmake-ucd')
```

`open(dir)` gives the readers that need to know where the files are:

#### `lines(file)`

Iterates the data lines, stripping comments and yielding the semicolon separated fields of each.

#### `missing(file)`

Iterates the `@missing` annotations, which give the values of the code points that a file leaves unlisted.

#### `property(file, values, fallback)`

Reads a file of the extracted properties into an array holding the value of every code point. `values` maps the names the file uses to the values to store, and a code point whose name is absent from it takes `fallback`, which is how the values a caller has no interest in are lumped together.

The rest take their data as arguments:

#### `range(field)` and `codePoints(field)`

Parse a code point or inclusive range such as `0041..005A`, and a space separated sequence.

#### `ranges(property)`

Compresses an array holding the value of every code point into a sorted, gap-free list of `[start, value]` pairs, each extending up to the start of the pair that follows it. How the pairs are packed into a table is left to the caller, the room a value needs being its own to know.

#### `blocks(shift)`, `rangeBlocks(starts, shift)` and `entryBlocks(codePoints, shift)`

Index a table by block, so that a lookup searches only the entries that may hold a given code point. `shift` is the number of low bits of a code point that a block leaves to the search it narrows down.

#### `pool()`

A pool of code point sequences that the entries of a table refer to by offset and length, sharing identical sequences.

#### `hex(value)` and `table(entries, perLine)`

Format a value, and wrap a list of already formatted entries across as many lines as needed.

## License

Apache-2.0
