// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path'
import { existsSync } from 'node:fs'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { launchCookie, launchCredentialMatches } from './launch-auth.js'
import { headerValue, type HttpCtx, type LiveSocket } from './http-context.js'
import { tokenExpiry, tokenFromRequest } from './session.js'

/** Fields a connected client needs in order to refresh. Names, bibs, entry ids and correction reasons stay off the socket. */
const WEBSOCKET_FIELDS: Record<string, readonly string[]> = {
  'timing_event.created': ['id', 'raceId', 'kind'],
  'correction.created': ['action'],
  'results.updated': ['raceId'],
}

export function websocketPayload(type: string, payload: unknown): Record<string, string> {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const projected: Record<string, string> = {}
  for (const key of WEBSOCKET_FIELDS[type] ?? []) {
    const value = source[key]
    if (typeof value !== 'string' || value.length === 0) continue
    if (key === 'kind' && value !== 'start') continue
    projected[key] = value
  }
  return projected
}

function rememberSocket(ctx: HttpCtx, socket: LiveSocket, exp: number): void {
  ctx.sockets.add(socket)
  const timer = setTimeout(() => {
    ctx.expiryTimers.delete(timer)
    ctx.sockets.delete(socket)
    socket.close(4401, 'expired')
  }, Math.max(0, exp - Date.now()))
  ctx.expiryTimers.add(timer)
  socket.on('close', () => {
    clearTimeout(timer)
    ctx.expiryTimers.delete(timer)
    ctx.sockets.delete(socket)
  })
}

function acceptSocket(ctx: HttpCtx, socket: LiveSocket, request: { headers: { authorization?: string | string[]; cookie?: string | string[] } }): void {
  const authorization = headerValue(request.headers.authorization)
  const cookie = headerValue(request.headers.cookie)
  if (ctx.options.launch) {
    if (!launchCredentialMatches(ctx.options.launch.token, { authorization, cookie })) {
      socket.close()
      return
    }
    ctx.sockets.add(socket)
    socket.on('close', () => ctx.sockets.delete(socket))
    socket.send(JSON.stringify({ type: 'device.status', payload: { proto: 1 } }))
    return
  }
  const exp = tokenExpiry(ctx.secretBox.current, tokenFromRequest({ authorization, cookie }))
  if (exp == null) {
    socket.close(4401, 'expired')
    return
  }
  rememberSocket(ctx, socket, exp)
  socket.send(JSON.stringify({ type: 'device.status', payload: { proto: 1 } }))
}

export function registerLaunchRoute(ctx: HttpCtx): void {
  const launch = ctx.options.launch
  if (!launch) return
  ctx.app.get('/auth', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const query = request.query as { code?: unknown }
    const presented = typeof query.code === 'string' ? query.code : ''
    if (!launch.codes.consume(presented)) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
    }
    reply.header('set-cookie', launchCookie(launch.token))
    return reply.redirect('/')
  })
}

export async function registerLiveSocket(ctx: HttpCtx): Promise<void> {
  await ctx.app.register(websocket)
  await ctx.app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket, request) => {
      acceptSocket(ctx, socket, request)
    })
  })
  const dist = ctx.options.webDist
  if (!dist || !existsSync(dist)) return
  await ctx.app.register(fastifyStatic, { root: path.resolve(dist), prefix: '/' })
  ctx.app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } })
      return
    }
    reply.sendFile('index.html')
  })
}
