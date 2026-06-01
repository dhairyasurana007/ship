import { getRegistry } from './registerRoute.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function generateOpenApiSpec(baseUrl = '') {
  const paths: Record<string, any> = {};

  for (const [key, meta] of getRegistry()) {
    const spaceIdx = key.indexOf(' ');
    const method = key.slice(0, spaceIdx).toLowerCase();
    const rawPath = key.slice(spaceIdx + 1);
    const openApiPath = rawPath.replace(/:([^/]+)/g, '{$1}');

    if (!paths[openApiPath]) paths[openApiPath] = {};

    const op: Record<string, any> = {
      operationId: meta.operationId,
      summary: meta.summary,
      responses: { '200': { description: 'Success' } },
    };

    if (meta.scope) {
      op.security = [{ bearerAuth: [meta.scope] }];
    }
    if (meta.requestSchema) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: zodToJsonSchema(meta.requestSchema, { target: 'openApi3' }),
          },
        },
      };
    }
    if (meta.responseSchema) {
      op.responses['200'].content = {
        'application/json': {
          schema: zodToJsonSchema(meta.responseSchema, { target: 'openApi3' }),
        },
      };
    }

    paths[openApiPath][method] = op;
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Ship Public API', version: '1.0.0' },
    servers: baseUrl ? [{ url: baseUrl }] : [],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths,
  };
}
