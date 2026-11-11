// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AppError, errorBody } from '@ert/core'
import { isLoopbackAddress, routeAccess } from './access.js'
import { allowedOriginsFromEnv, desktopHostAllowed, desktopOriginAllowed, hostAllowed, jsonContentType, originAllowed } from './guard.js'
import { launchCredentialMatches } from './launch-auth.js'
import { headerValue, type HttpCtx } from './http-context.js'
import { raceApiOpen } from './key-routes.js'

function listenPort(app: FastifyInstance): number | null {
  const address = app.server.address()
  return typeof address === 'object' && address ? address.port : null
}

function isUpgrade(request: FastifyRequest): boolean {
  return request.headers.upgrade?.toLowerCase() === 'websocket' || request.url.split('?')[0] === '/ws'
}

function hostRejected(reply: FastifyReply, ok: boolean): boolean {
  if (ok) return false
  reply.status(421).send({ error: { code: 'VALIDATION_ERROR', message: 'Host not allowed' } })
  return true
}

function originRejected(reply: FastifyReply, desktop: boolean, originOk: boolean, origin: string | undefined): boolean {
  const denied = desktop ? !originOk : Boolean(origin) && !originOk
  if (!denied) return false
  reply.status(403).send({ error: { code: 'VALIDATION_ERROR', message: 'Origin not allowed' } })
  return true
}

function contentTypeRejected(reply: FastifyReply, header: string | undefined): boolean {
  if (jsonContentType(header)) return false
  reply.status(415).send({ error: { code: 'VALIDATION_ERROR', message: 'Content-Type must be application/json' } })
  return true
}

/** Host, origin, and JSON checks. A websocket upgrade is left for the later hook. */
export function registerRequestGuards(app: FastifyInstance, desktop: boolean): void {
  app.addHook('onRequest', async (request, reply) => {
    const port = listenPort(app)
    const hostOk = desktop ? desktopHostAllowed(request.headers.host, port) : hostAllowed(request.headers.host, port)
    if (hostRejected(reply, hostOk) || isUpgrade(request)) return
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    const originOk = desktop ? desktopOriginAllowed(origin, port) : originAllowed(origin, port, allowedOriginsFromEnv())
    if (originRejected(reply, desktop, originOk, origin)) return
    contentTypeRejected(reply, request.headers['content-type'])
  })
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status).send(errorBody(error))
      return
    }
    const validation = error as { validation?: unknown; message?: string; statusCode?: number }
    if (validation.validation) {
      reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: validation.message, details: validation.validation } })
      return
    }
    if (validation.statusCode && validation.statusCode < 500) {
      reply.status(validation.statusCode).send({ error: { code: 'VALIDATION_ERROR', message: validation.message } })
      return
    }
    app.log.error(error)
    reply.status(500).send({ error: { code: 'VALIDATION_ERROR', message: 'Internal error' } })
  })
}

function socketOriginRejected(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, desktop: boolean): boolean {
  const path = request.url.split('?')[0]
  const url = request.routeOptions.url
  const socket = request.headers.upgrade?.toLowerCase() === 'websocket' || path === '/ws' || url === '/ws'
  if (!socket) return false
  const port = listenPort(app)
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
  const originOk = desktop ? desktopOriginAllowed(origin, port) : originAllowed(origin, port, allowedOriginsFromEnv())
  if (originOk) return false
  reply.status(403).send({ error: { code: 'VALIDATION_ERROR', message: 'Origin not allowed' } })
  return true
}

function launchRejected(reply: FastifyReply, ctx: HttpCtx, request: FastifyRequest): boolean {
  if (!ctx.options.launch) return false
  const presented = {
    authorization: headerValue(request.headers.authorization),
    cookie: headerValue(request.headers.cookie),
  }
  if (launchCredentialMatches(ctx.options.launch.token, presented)) return false
  reply.status(401).send({ error: { code: 'VALIDATION_ERROR', message: 'Unauthorized' } })
  return true
}

function accessRejected(reply: FastifyReply, request: FastifyRequest, authenticated: HttpCtx['authenticated']): void {
  const url = request.routeOptions.url
  if (!url) return
  const method = request.method === 'HEAD' ? 'GET' : request.method
  const access = routeAccess(method, url)
  if (!access || (access !== 'public' && !(access === 'local' && isLoopbackAddress(request.ip)) && !authenticated(request))) {
    reply.status(401).send(errorBody(new AppError('PIN_REQUIRED', 'PIN required')))
  }
}

export function registerAccessGuard(ctx: HttpCtx): void {
  const desktop = Boolean(ctx.options.launch)
  ctx.app.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return
    if (socketOriginRejected(ctx.app, request, reply, desktop)) return
    const url = request.routeOptions.url
    if (!url || (!url.startsWith('/api/') && url !== '/ws')) return
    if (launchRejected(reply, ctx, request)) return
    accessRejected(reply, request, ctx.authenticated)
  })
}

function gateExempt(url: string): boolean {
  return url.startsWith('/api/v1/keys') || url === '/api/v1/health' || url === '/api/v1/time'
}

/** Race routes stay closed until an admin session is open. Key, health and time stay available. */
export function registerUseGate(ctx: HttpCtx, racePath: string): void {
  ctx.app.addHook('preHandler', async (request, reply) => {
    if (reply.sent) return
    const url = request.routeOptions.url ?? ''
    if (!url.startsWith('/api/') || gateExempt(url)) return
    if (raceApiOpen(ctx.slot.current, racePath, Boolean(ctx.slot.startedLocked))) return
    reply.status(423).send({ error: { code: 'KEY_GATE', message: 'Open the race file first.' } })
  })
}
