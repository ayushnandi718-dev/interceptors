// @vitest-environment node
import http from 'node:http'
import type { Socket } from 'node:net'
import { ClientRequestInterceptor } from '#/src/interceptors/ClientRequest'

const interceptor = new ClientRequestInterceptor()

afterEach(() => {
  interceptor.removeAllListeners()
  interceptor.dispose()
})

/**
 * Read the idle timeout timer Node.js keeps on the socket under an
 * internal symbol (the one the stock `net.Socket._destroy` clears).
 */
function getSocketTimeoutTimer(socket: Socket): NodeJS.Timeout | null {
  const timeoutSymbol = Object.getOwnPropertySymbols(socket).find(
    (symbol) => symbol.description === 'timeout'
  )

  if (!timeoutSymbol) {
    return null
  }

  const socketInternals = socket as unknown as Record<
    symbol,
    NodeJS.Timeout | null
  >
  return socketInternals[timeoutSymbol]
}

it('releases the client socket after a mocked response', async () => {
  interceptor.apply()
  interceptor.on('request', ({ controller }) => {
    controller.respondWith(Response.json({ ok: true }))
  })

  let clientSocket: Socket | undefined

  await new Promise<void>((resolve, reject) => {
    const request = http.get('http://localhost/resource', (response) => {
      response.resume()
      response.on('end', resolve)
    })
    request.on('socket', (socket) => {
      clientSocket = socket as Socket
    })
    request.on('error', reject)
  })

  await expect.poll(() => clientSocket?.destroyed).toBe(true)

  // The mocked connection must not keep its TCP handle open: the handle's
  // wrapped "connect" closes over the socket controller, which keeps the
  // interceptor and its module graph reachable for the process lifetime.
  await expect.poll(() => clientSocket?._handle ?? null).toBeNull()

  // The agent arms a 5s idle timeout on every socket. Left armed, it pins
  // the socket until it fires even after the response has ended.
  await expect
    .poll(() => getSocketTimeoutTimer(clientSocket!))
    .toBeNull()
})
