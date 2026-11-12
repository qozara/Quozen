import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { groupsRouter } from './routes/groups.js';

export const app = new OpenAPIHono();

// Security Headers (nosniff, X-Frame-Options, Referrer-Policy, HSTS, etc.)
app.use('*', secureHeaders({
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    xPermittedCrossDomainPolicies: 'none',
    xDownloadOptions: 'noopen',
}));

// CORS Configuration - Restrict to Quozen/Qozara production, Quozen Vercel previews, and local dev
app.use('*', cors({
    origin: (origin) => {
        if (!origin) return '*';
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return origin;
        }
        // Match https://quozen.org, https://qozara.org and their subdomains
        if (/^https:\/\/(?:[a-zA-Z0-9-]+\.)*(?:quozen\.org|qozara\.org)$/.test(origin)) {
            return origin;
        }
        // Match only Quozen-specific Vercel preview and production deployments (e.g. quozen.vercel.app, quozen-git-*.vercel.app)
        if (/^https:\/\/quozen(?:-[a-zA-Z0-9]+)*\.vercel\.app$/.test(origin)) {
            return origin;
        }
        return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'If-Match'],
    exposeHeaders: ['Content-Length', 'ETag'],
    maxAge: 86400,
}));

// Register Security Scheme for Bearer Auth
app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT', // Optional: hints that it's a JWT token
});

// OpenAPI specification endpoint
app.doc('/api/openapi.json', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0',
        title: 'Quozen API',
        description: 'Stateless Edge REST API for Quozen decentralized expense sharing'
    },
    // Apply security globally to show the "Authorize" button and lock icons
    security: [{ Bearer: [] }],
});

// Swagger UI endpoint
app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

// Mount routers
app.route('/api/v1/groups', groupsRouter);

export default app;
