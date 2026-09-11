const test = require('brittle')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const spawn = require('cmake-runtime/spawn')

const VERSION = '17.0.0'
const DATA = `# Version: ${VERSION}\n0041;LATIN CAPITAL LETTER A;Lu\n`

async function origin(t, respond) {
  const requests = []

  const server = http.createServer((req, res) => {
    requests.push(req.url)

    respond(res, requests.length, req.url)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  t.teardown(() => {
    server.closeAllConnections()

    return new Promise((resolve) => server.close(resolve))
  })

  return { requests, port: server.address().port }
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

function fetch(t, port, opts = {}) {
  const {
    collection = 'UCD',
    name = 'UnicodeData.txt',
    attempts = 5,
    delay = 0,
    timeout = 30
  } = opts

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmake-ucd-'))

  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))

  const args = [
    '-D',
    `ucd_url=http://127.0.0.1:${port}/Public`,
    '-D',
    `ucd_fetch_attempts=${attempts}`,
    '-D',
    `ucd_fetch_delay=${delay}`,
    '-D',
    `ucd_fetch_timeout=${timeout}`,
    '-D',
    `collection=${collection}`,
    '-D',
    `name=${name}`,
    '-P',
    path.join(__dirname, 'fetch.cmake')
  ]

  // The origin is served by this process, on the loopback interface: the child has
  // to be waited on without blocking the loop that answers it, and must not be sent
  // through whatever proxy the environment configures.
  return new Promise((resolve) => {
    const child = spawn({
      args,
      cwd: dir,
      env: { ...process.env, no_proxy: '127.0.0.1', NO_PROXY: '127.0.0.1' }
    })

    let stderr = ''

    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => (stderr += chunk))

    child.on('close', (code) => {
      resolve({ code, stderr, file: path.join(dir, '_ucd', VERSION, name) })
    })
  })
}

test('a fetch retries a failing origin until it answers', async (t) => {
  const { requests, port } = await origin(t, (res, count) => {
    if (count <= 2) return res.writeHead(503).end()

    res.writeHead(200, { 'content-type': 'text/plain' }).end(DATA)
  })

  const result = await fetch(t, port)

  t.is(result.code, 0, result.stderr)
  t.is(requests.length, 3, 'the two failures were retried')
  t.is(read(result.file), DATA)
})

test('a fetch gives up after the attempts it is allowed', async (t) => {
  const { requests, port } = await origin(t, (res) => res.writeHead(503).end())

  const result = await fetch(t, port, { attempts: 3 })

  t.not(result.code, 0, 'the fetch failed')
  t.is(requests.length, 3, 'every attempt was made')
  t.ok(result.stderr.includes('UnicodeData.txt'), 'the error names the file')
  t.absent(fs.existsSync(result.file), 'nothing was left behind')
})

test('a collection falls back without spending its attempts on the miss', async (t) => {
  const { requests, port } = await origin(t, (res, count, url) => {
    if (url.includes(`idna/${VERSION}`)) return res.writeHead(404).end()

    res.writeHead(200, { 'content-type': 'text/plain' }).end(DATA)
  })

  const result = await fetch(t, port, { collection: 'IDNA', name: 'IdnaMappingTable.txt' })

  t.is(result.code, 0, result.stderr)
  t.is(requests.length, 2, 'the versioned path was tried once, then the fallback')
})

test('a fetch abandons an origin that accepts but never answers', async (t) => {
  const { requests, port } = await origin(t, () => {})

  const started = Date.now()

  const result = await fetch(t, port, { attempts: 1, timeout: 1 })

  t.not(result.code, 0, 'the fetch failed')
  t.is(requests.length, 1, 'the stalled attempt was made')
  t.ok(Date.now() - started < 15000, 'it did not wait on the origin indefinitely')
})
