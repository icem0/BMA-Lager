// Server-Bootstrap: Fastify mit allen Plugins und Routes.

import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyCookie from '@fastify/cookie'
import { config } from './config/config.js'
import { registerJwt } from './auth/jwt.js'
import { registerAuthDecorators } from './auth/middleware.js'
import { registerRateLimit } from './auth/rate-limit.js'
import { authRoutes } from './auth/routes.js'
import { syncRoutes } from './sync/routes.js'
import { fotoRoutes } from './fotos/routes.js'
import { userRoutes } from './users/routes.js'
import { closeDb } from './db/client.js'

async function main() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        process.env['NODE_ENV'] === 'production'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    },
    bodyLimit: 4 * 1024 * 1024, // 4 MB für Push-Payloads
  })

  // Plugins
  await app.register(fastifyHelmet, { contentSecurityPolicy: false })
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
  await app.register(fastifyCookie)
  await registerRateLimit(app)
  await registerJwt(app)
  registerAuthDecorators(app)

  // Health-Endpoint (zuerst, kein Auth)
  app.get('/api/healthz', async () => ({
    status: 'ok',
    service: 'bma-lager-server',
    time: new Date().toISOString(),
  }))

  // Login-Rate-Limit (nur für Login-Route)
  await app.register(async (instance) => {
    await authRoutes(instance)
  })

  // Restliche Routes (mit requireAuth als preHandler)
  await app.register(async (instance) => {
    instance.addHook('preHandler', instance.requireAuth)
    await syncRoutes(instance)
    await userRoutes(instance)
    await fotoRoutes(instance)
  })

  // Globaler Error-Handler: einheitliches Format
  app.setErrorHandler((err: unknown, _req, reply) => {
    const e = err as { code?: string; message?: string; statusCode?: number }
    app.log.error(e)
    const code = e.code ?? 'INTERNAL'
    if (
      code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' ||
      code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER'
    ) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: e.message ?? 'Unauthorized' })
    }
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ code: 'PAYLOAD_TOO_LARGE', message: 'Datei zu groß' })
    }
    return reply.code(e.statusCode ?? 500).send({
      code,
      message: e.message ?? 'Interner Server-Fehler',
    })
  })

  // Cleanup
  const shutdown = async (signal: string) => {
    app.log.info(`Signal ${signal} empfangen, fahre herunter …`)
    await app.close()
    await closeDb()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    app.log.info(`bma-lager-server listening on ${config.HOST}:${config.PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()